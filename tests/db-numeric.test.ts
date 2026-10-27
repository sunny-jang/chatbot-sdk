import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUnit, parseKoreanNumber, parseNumericIntent, passesNumericIntent } from "../lib/db-sources/numeric";
import { sourcesOf } from "../lib/db-sources/search";
import { numericFieldsOf } from "../lib/db-sources/render";

test("parseKoreanNumber: 만·천·쉼표·소수", () => {
  assert.equal(parseKoreanNumber("2만"), 20000);
  assert.equal(parseKoreanNumber("1.5만"), 15000);
  assert.equal(parseKoreanNumber("3천"), 3000);
  assert.equal(parseKoreanNumber("2만5천"), 25000);
  assert.equal(parseKoreanNumber("15,000"), 15000);
  assert.equal(parseKoreanNumber("abc"), null);
});

test("parseNumericIntent: 이하/이상/미만/초과/까지/부터/~/대", () => {
  assert.deepEqual(parseNumericIntent("2만원 이하 선물세트 있어요?"), [{ op: "lte", value: 20000, unit: "원" }]);
  assert.deepEqual(parseNumericIntent("15,000원 이상"), [{ op: "gte", value: 15000, unit: "원" }]);
  assert.deepEqual(parseNumericIntent("5천원 미만 디저트"), [{ op: "lt", value: 5000, unit: "원" }]);
  assert.deepEqual(parseNumericIntent("3만원 넘는 거"), [{ op: "gt", value: 30000, unit: "원" }]);
  assert.deepEqual(parseNumericIntent("1만~2만원 선물"), [{ op: "gte", value: 10000, unit: "원" }, { op: "lte", value: 20000, unit: "원" }]);
  assert.deepEqual(parseNumericIntent("2만원대 세트"), [{ op: "gte", value: 20000, unit: "원" }, { op: "lt", value: 30000, unit: "원" }]);
  assert.deepEqual(parseNumericIntent("10개 이상 단체 주문"), [{ op: "gte", value: 10, unit: "개" }]);
});

test("parseNumericIntent: 단위 없는 숫자·조건어 없는 금액은 조건이 아님", () => {
  assert.deepEqual(parseNumericIntent("X-200 모델 사양"), []);
  assert.deepEqual(parseNumericIntent("2026년 신메뉴"), []);
  assert.deepEqual(parseNumericIntent("아메리카노 4500원 맞아요?"), []);
  assert.deepEqual(parseNumericIntent("아메리카노 얼마예요?"), []);
});

test("passesNumericIntent: 같은 단위 필드만 비교, 필드 없는 문서는 통과", () => {
  const set = [{ column: "price", label: "가격", unit: "원", value: 18000 }];
  const lte2 = parseNumericIntent("2만원 이하");
  assert.equal(passesNumericIntent(set, lte2), true);
  assert.equal(passesNumericIntent([{ column: "price", label: "가격", unit: "원", value: 25000 }], lte2), false);
  assert.equal(passesNumericIntent(null, lte2), true, "일반 문서는 거르지 않음");
  assert.equal(passesNumericIntent([{ column: "stock", label: "재고", unit: "개", value: 3 }], lte2), true, "다른 단위만 있으면 통과");
  assert.equal(passesNumericIntent(set, []), true);
});

test("numericFieldsOf: 숫자 타입 본문 컬럼만, 문자열 숫자도 값으로", () => {
  const fields = numericFieldsOf(
    { price: "25000", name: "세트", zip: "06236", stock: 3 },
    [
      { column: "price", label: "가격", unit: "원", type: "numeric" },
      { column: "zip", label: "우편번호", type: "text" },
      { column: "stock", label: "재고", unit: "개", type: "integer" },
    ],
  );
  assert.deepEqual(fields, [
    { column: "price", label: "가격", unit: "원", value: 25000 },
    { column: "stock", label: "재고", unit: "개", value: 3 },
  ]);
});

test("리뷰 반영: 단위 정리·복합 금액 '대'·날짜 필드·타입 없는 숫자 문자열·출처 중복 제거", () => {
  assert.equal(normalizeUnit("KRW"), "원");
  assert.equal(normalizeUnit("₩"), "원");
  assert.equal(normalizeUnit("원(부가세 포함)"), "원");
  assert.equal(normalizeUnit("EA"), "개");
  assert.equal(passesNumericIntent([{ column: "price", label: "가격", unit: "KRW", value: 35000 }], parseNumericIntent("2만원 이하")), false, "KRW 표기도 원으로 비교");
  assert.deepEqual(parseNumericIntent("1만5천원대 선물"), [{ op: "gte", value: 15000, unit: "원" }, { op: "lt", value: 16000, unit: "원" }]);
  const fields = numericFieldsOf(
    { opened: "2026-10-01", price: "25000", code: "0012" },
    [
      { column: "opened", label: "오픈일", type: "date" },
      { column: "price", label: "가격", unit: "₩" },
      { column: "code", label: "코드" },
    ],
  );
  assert.deepEqual(fields, [
    { column: "opened", label: "오픈일", unit: "date", value: Date.UTC(2026, 9, 1) / 1000 },
    { column: "price", label: "가격", unit: "원", value: 25000 },
  ]);
  const doc = (title: string, db: boolean) => ({ id: title, title, content: "", score: 1, source: db ? { kind: "db" as const, label: title } : null });
  assert.deepEqual(sourcesOf([doc("아메리카노", true), doc("FAQ", false), doc("아메리카노", true)]), [{ kind: "db", label: "아메리카노" }]);
});
