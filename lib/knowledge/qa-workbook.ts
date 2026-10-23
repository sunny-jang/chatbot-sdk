import * as XLSX from "xlsx";
export const MAX_QA_SHEETS = 30;
const QUESTION_HEADERS = ["질문", "question"],
  ANSWER_HEADERS = ["질문상세", "답변", "answer"],
  // Bookkeeping columns that must never be read to visitors as part of an answer.
  METADATA_HEADERS = [
    "비고",
    "메모",
    "담당자",
    "작성자",
    "수정일",
    "등록일",
    "날짜",
    "note",
    "notes",
    "memo",
    "owner",
    "author",
    "updated",
    "date",
  ];
export type QaWorkbookRow = {
  folder: string;
  question: string;
  answer: string;
  /** 1-based worksheet row of the question, for error messages. */
  line: number;
};
/**
 * Answer text joins the answer column and every column after it, except bookkeeping columns
 * (비고, 담당자, 수정일, …) which are skipped rather than merged into the answer.
 * Blank-question rows continue the previous answer. Sheets past MAX_QA_SHEETS are reported, not read.
 */
export function parseQaWorkbook(
  workbook: XLSX.WorkBook,
  report: { skippedSheets: string[] } = { skippedSheets: [] },
) {
  const rows: QaWorkbookRow[] = [];
  report.skippedSheets.push(...workbook.SheetNames.slice(MAX_QA_SHEETS));
  for (const sheetName of workbook.SheetNames.slice(0, MAX_QA_SHEETS)) {
    const values = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, defval: "" },
    );
    const headerIndex = values.findIndex((row) =>
      row.some((cell) => QUESTION_HEADERS.includes(String(cell).trim())),
    );
    if (headerIndex < 0) continue;
    const header = values[headerIndex].map((cell) => String(cell).trim());
    const questionIndex = header.findIndex((cell) =>
      QUESTION_HEADERS.includes(cell),
    );
    const namedAnswer = header.findIndex((cell) =>
      ANSWER_HEADERS.includes(cell),
    );
    const answerIndex = namedAnswer >= 0 ? namedAnswer : questionIndex + 1;
    const isAnswerColumn = (index: number) =>
      index >= answerIndex &&
      index !== questionIndex &&
      !METADATA_HEADERS.includes((header[index] ?? "").toLowerCase());
    let pending: QaWorkbookRow | null = null;
    values.slice(headerIndex + 1).forEach((raw, offset) => {
      const row = raw.map((cell) => String(cell ?? "").trim());
      const question = row[questionIndex] ?? "";
      const answerParts = row.filter((cell, index) => cell && isAnswerColumn(index));
      if (question) {
        if (pending) rows.push(pending);
        pending = answerParts.length
          ? {
              folder: sheetName,
              question,
              answer: answerParts.join("\n\n"),
              line: headerIndex + offset + 2,
            }
          : null;
      } else if (pending && answerParts.length) {
        pending.answer += `\n\n${answerParts.join("\n\n")}`;
      }
    });
    if (pending) rows.push(pending);
  }
  return rows;
}
