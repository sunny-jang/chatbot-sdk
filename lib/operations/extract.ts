import { load } from "cheerio";
import { OperationError } from "./input";
export function extractPage(html: string) {
  const $ = load(html);
  const title =
    $("title").first().text().trim().slice(0, 300) ||
    $("h1").first().text().trim().slice(0, 300) ||
    "웹페이지";
  $(
    "script,style,noscript,nav,footer,header,aside,form,svg,iframe,[hidden],[aria-hidden='true']",
  ).remove();
  const main = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");
  main.find("br").replaceWith("\n");
  main.find("p,div,section,li,h1,h2,h3,h4,tr").append("\n");
  const content = main
    .text()
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (content.length < 30)
    throw new OperationError(
      "본문을 찾지 못했습니다. 로그인 또는 브라우저 실행이 필요한 페이지일 수 있습니다.",
    );
  if (content.length > 50000)
    throw new OperationError("본문이 50,000자 제한을 초과합니다.");
  return { title, content };
}
