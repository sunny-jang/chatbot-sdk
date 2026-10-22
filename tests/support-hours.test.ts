import test from 'node:test';
import assert from 'node:assert/strict';
import { getSupportStatus } from '../lib/supportHours';
const hours = { enabled:true, days:[1], start:'09:00', end:'18:00' };
const bot = { support_mode:'hybrid', support_hours:hours };
test('한국 시각 시작 포함·종료 제외 및 요일 검사', () => {
  for (const [date, expected] of [['2026-10-19T08:59:00+09:00',false],['2026-10-19T09:00:00+09:00',true],['2026-10-19T17:59:00+09:00',true],['2026-10-19T18:00:00+09:00',false],['2026-10-20T10:00:00+09:00',false]] as const) assert.equal(getSupportStatus(bot,new Date(date)).live,expected,date);
});
test('야간 운영은 시작 요일의 다음 날 새벽까지 적용', () => {
 const night = {...bot,support_hours:{...hours,start:'22:00',end:'02:00'}};
 assert.equal(getSupportStatus(night,new Date('2026-10-20T01:59:00+09:00')).live,true);
 assert.equal(getSupportStatus(night,new Date('2026-10-20T02:00:00+09:00')).live,false);
});
test('강제 무인·무인 모드는 시간 안이어도 연결 불가', () => {
 const date = new Date('2026-10-19T10:00:00+09:00');
 assert.equal(getSupportStatus({...bot,force_unattended:true},date).reason,'forced');
 assert.equal(getSupportStatus({...bot,support_mode:'unattended'},date).live,false);
});
