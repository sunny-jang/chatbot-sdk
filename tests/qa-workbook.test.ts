import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { parseQaWorkbook } from "../lib/knowledge/qa-workbook";
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
    },
    { folder: "이용 안내", question: "주차?", answer: "가능\n\n무료" },
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
