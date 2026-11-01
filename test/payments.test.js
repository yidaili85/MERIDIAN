import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validateConfig,validWallet,transactionHash,methods,createCheckout,capturePayPal,verifyPayPalWebhook,safeCheckoutURL} from '../payments.js';
const env={PUBLIC_BASE_URL:'https://shop.example.com',PAYPAL_CLIENT_ID:'test-id',PAYPAL_CLIENT_SECRET:'test-secret',PAYPAL_WEBHOOK_ID:'test-hook'};
const order={id:'MY-test',details:{total:189,currency:'USD'}};
const respond=data=>({ok:true,json:async()=>data});
test('wallet validation, configuration and readiness',()=>{
 assert.equal(methods(defaults,{}).paypal,false);assert.equal(methods({...defaults,paypalEnabled:true},env).paypal,true);
 assert.equal(methods({...defaults,paypalEnabled:true},{...env,PAYPAL_WEBHOOK_ID:''}).paypal,false);
 assert.ok(validWallet('trc20','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'));assert.equal(validWallet('trc20','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj61'),false);
 assert.equal(validWallet('erc20','0x'+'0'.repeat(40)),false);
 assert.throws(()=>validateConfig({...defaults,usdtEnabled:true}));assert.throws(()=>validateConfig({...defaults,usdtRate:0}));
 assert.equal(transactionHash('0x'+'A'.repeat(64)),'a'.repeat(64));assert.throws(()=>transactionHash('fake'));
 assert.throws(()=>safeCheckoutURL('https://evil.example/pay','paypal','live'));assert.throws(()=>safeCheckoutURL('https://www.sandbox.paypal.com/pay','paypal','live'));
});
test('USDT payment snapshots configured wallet, network and quote without external requests',async()=>{
 const p=await createCheckout(order,{...defaults,usdtNetwork:'erc20',usdtAddress:'0x'+'1'.repeat(40),usdtRate:1.02},{},'usdt',()=>{throw Error('must not call remote service');});
 assert.equal(p.usdtAmount,'192.780000');assert.equal(p.status,'pending');assert.equal(p.amount,'189.00');
});
test('PayPal create uses server total, explicit environment, idempotency and official URL',async()=>{
 const calls=[];const p=await createCheckout(order,defaults,env,'paypal',async(url,options)=>{calls.push({url,options});return respond(url.endsWith('/token')?{access_token:'test-access'}:{id:'PP-1',links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=PP-1'}]});});
 assert.equal(p.providerId,'PP-1');assert.ok(calls.every(c=>c.url.startsWith('https://api-m.sandbox.paypal.com/')));assert.equal(calls[1].options.headers['PayPal-Request-Id'],order.id);
 const body=JSON.parse(calls[1].options.body);assert.equal(body.purchase_units[0].amount.value,'189.00');assert.equal(body.payment_source.paypal.experience_context.return_url,'https://shop.example.com/?payment=return&order=MY-test');
});
test('PayPal approval alone is unpaid; capture checks reference, captured amount and currency',async()=>{
 const p={providerId:'PP-1',mode:'sandbox',amount:'189.00'};
 const complete={id:'PP-1',status:'COMPLETED',purchase_units:[{custom_id:order.id,payments:{captures:[{id:'CAP-1',status:'COMPLETED',amount:{currency_code:'USD',value:'189.00'}}]}}]};
 const mock=state=>async url=>respond(url.endsWith('/token')?{access_token:'test-access'}:state);
 assert.equal(await capturePayPal(p,order.id,env,mock({id:'PP-1',status:'CREATED'})),null);
 const calls=[];assert.equal(await capturePayPal(p,order.id,env,async(url,opts)=>{calls.push({url,opts});return respond(url.endsWith('/token')?{access_token:'test-access'}:url.endsWith('/capture')?complete:{id:'PP-1',status:'APPROVED'});}), 'CAP-1');assert.equal(calls.length,3);
 assert.equal(await capturePayPal(p,order.id,env,mock(complete)),'CAP-1');
 for(const [currency,value] of [['EUR','189.00'],['USD','1.00']]){const invalid=structuredClone(complete);invalid.purchase_units[0].payments.captures[0].amount={currency_code:currency,value};await assert.rejects(capturePayPal(p,order.id,env,mock(invalid)),/amount or currency/);}
 const wrong=structuredClone(complete);wrong.purchase_units[0].custom_id='OTHER';await assert.rejects(capturePayPal(p,order.id,env,mock(wrong)),/reference mismatch/);
});
test('PayPal webhook signature failure is rejected',async()=>{
 await assert.rejects(verifyPayPalWebhook({}, {}, defaults,env,async url=>respond(url.endsWith('/token')?{access_token:'test-access'}:{verification_status:'FAILURE'})),/signature/);
 await verifyPayPalWebhook({}, {}, defaults,env,async url=>respond(url.endsWith('/token')?{access_token:'test-access'}:{verification_status:'SUCCESS'}));
});
