import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { MAX_QA_SHEETS, parseQaWorkbook } from "../lib/knowledge/qa-workbook";
test("Q&A workbook preserves introductory rows, sheet folders and multiline answers", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["고객 안내 자료"],
      ["질문을 아래에 작성해주세요"],
      ["번호", "질문", "질문상세", "추가"],
      [1, "영업시간?", "9시", "18시"],
      ["", "", "주말 휴무"],
      [2, "주차?", "가능"],
      ["", "", "무료"],
    ]),
    "이용 안내",
  );
  assert.deepEqual(parseQaWorkbook(wb), [
    {
      folder: "이용 안내",
      question: "영업시간?",
      answer: "9시\n\n18시\n\n주말 휴무",
      line: 4,
    },
    { folder: "이용 안내", question: "주차?", answer: "가능\n\n무료", line: 6 },
  ]);
});
test("Q&A workbook skips bookkeeping columns such as 담당자/수정일", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["질문", "답변", "", "담당자", "수정일"],
      ["배송?", "2일", "도서 지역 3일", "홍길동", "2026-01-01"],
      ["", "주말 제외", "", "김담당", ""],
    ]),
    "배송",
  );
  assert.deepEqual(parseQaWorkbook(wb), [
    {
      folder: "배송",
      question: "배송?",
      answer: "2일\n\n도서 지역 3일\n\n주말 제외",
      line: 2,
    },
  ]);
});
test("Q&A workbook reports sheets beyond the limit instead of dropping them silently", () => {
  const wb = XLSX.utils.book_new();
  for (let i = 1; i <= MAX_QA_SHEETS + 2; i++)
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["질문", "답변"], [`q${i}`, `a${i}`]]),
      `시트${i}`,
    );
  const report = { skippedSheets: [] as string[] };
  assert.equal(parseQaWorkbook(wb, report).length, MAX_QA_SHEETS);
  assert.deepEqual(report.skippedSheets, [
    `시트${MAX_QA_SHEETS + 1}`,
    `시트${MAX_QA_SHEETS + 2}`,
  ]);
});
test("Q&A workbook does not interpret instruction-only sheets as questions", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["작성 안내"], ["내용"]]),
    "안내",
  );
  assert.deepEqual(parseQaWorkbook(wb), []);
});
