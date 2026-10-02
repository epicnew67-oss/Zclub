import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#') && l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim()]}));
assert(['localhost','127.0.0.1'].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname), 'Payment regression fixtures must stay local');
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
async function ok(request) {const {data,error}=await request;if(error)throw error;return data;}
const password=randomUUID();
const {user}=await ok(admin.auth.admin.createUser({email:`payment-order-${randomUUID()}@test.local`,password,email_confirm:true}));
const buyer=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
await ok(buyer.auth.signInWithPassword({email:user.email,password}));
const pack=await ok(admin.from('token_packs').select('*').eq('is_active',true).limit(1).single());
async function fixture() {
 const pay=await ok(admin.from('payments').insert({user_id:user.id,external_id:randomUUID(),token_pack_id:pack.id,tokens:pack.tokens,price_pkr:pack.price_pkr,status:'pending',pay_status:'waiting',pay_amount:1,pay_currency:'ltc'}).select('*').single());
 const topup=await ok(admin.from('topup_requests').insert({user_id:user.id,payment_id:pay.id,token_pack_id:pack.id,tokens:pack.tokens,method:'crypto',status:'pending'}).select('*').single());
 return {pay,topup};
}
const apply=(f,status)=>ok(admin.rpc('nowpayments_webhook_apply',{_payment_id:f.pay.external_id,_ipn_status:status,_actually_paid:status==='finished'?1:0}));
const cancel=f=>ok(buyer.rpc('cancel_crypto_topup',{_topup_id:f.topup.id}));
async function checkCompleted(f) {
 const t=await ok(admin.from('topup_requests').select('status').eq('id',f.topup.id).single());
 const p=await ok(admin.from('payments').select('status,pay_status').eq('id',f.pay.id).single());
 assert.equal(t.status,'completed');assert.equal(p.status,'confirmed');assert.equal(p.pay_status,'finished');
 const entries=await ok(admin.from('ledger_entries').select('amount').eq('ref_type','payment').eq('ref_id',f.pay.id));
 assert.equal(entries.length,1);assert.equal(entries[0].amount,pack.tokens);
}
const finished=await fixture();
await apply(finished,'finished');
for(const status of ['expired','failed','waiting','confirming','partially_paid','finished']) { await apply(finished,status); await checkCompleted(finished); }
await checkCompleted(finished);
console.log('PASS: delayed and replayed webhooks cannot downgrade a credited payment');
assert.equal((await cancel(finished)).ok,false);
await checkCompleted(finished);
console.log('PASS: cancelling a completed payment is refused without changing its state');
const cancelled=await fixture();assert.equal((await cancel(cancelled)).ok,true);
await apply(cancelled,'waiting');
const cancelledPay=await ok(admin.from('payments').select('pay_status').eq('id',cancelled.pay.id).single());
assert.equal(cancelledPay.pay_status,'cancelled');
await apply(cancelled,'finished');await checkCompleted(cancelled);
console.log('PASS: funds arriving after cancellation still credit exactly once');
for(let n=0;n<5;n++) {
 const f=await fixture();await Promise.all([cancel(f),apply(f,'finished')]);await checkCompleted(f);
}
console.log('PASS: five concurrent cancel/confirmation races retain completed status and one credit');
const anonymous=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
assert((await anonymous.rpc('cancel_crypto_topup',{_topup_id:cancelled.topup.id})).error);
const foreign=await fixture();
const password2=randomUUID();const {user:other}=await ok(admin.auth.admin.createUser({email:`payment-other-${randomUUID()}@test.local`,password:password2,email_confirm:true}));
await ok(anonymous.auth.signInWithPassword({email:other.email,password:password2}));
assert.equal((await ok(anonymous.rpc('cancel_crypto_topup',{_topup_id:foreign.topup.id}))).ok,false);
console.log('PASS: anonymous and other buyers cannot cancel the payment');
