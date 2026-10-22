import * as XLSX from "xlsx";
export function parseQaWorkbook(workbook: XLSX.WorkBook) {
  const rows: { folder: string; question: string; answer: string }[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 7)) {
    const values = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, defval: "" },
    );
    const headerIndex = values.findIndex((row) =>
      row.some((cell) => ["질문", "question"].includes(String(cell).trim())),
    );
    if (headerIndex < 0) continue;
    const header = values[headerIndex].map((cell) => String(cell).trim());
    const questionIndex = header.findIndex((cell) =>
      ["질문", "question"].includes(cell),
    );
    const namedAnswer = header.findIndex((cell) =>
      ["질문상세", "답변", "answer"].includes(cell),
    );
    const answerIndex = namedAnswer >= 0 ? namedAnswer : questionIndex + 1;
    let pending: { folder: string; question: string; answer: string } | null =
      null;
    for (const raw of values.slice(headerIndex + 1)) {
      const row = raw.map((cell) => String(cell ?? "").trim());
      const question = row[questionIndex] ?? "";
      const answerParts = row.slice(answerIndex).filter(Boolean);
      if (question) {
        if (pending) rows.push(pending);
        pending = answerParts.length
          ? { folder: sheetName, question, answer: answerParts.join("\n\n") }
          : null;
      } else if (pending && answerParts.length) {
        pending.answer += `\n\n${answerParts.join("\n\n")}`;
      }
    }
    if (pending) rows.push(pending);
  }

  return rows;
}
