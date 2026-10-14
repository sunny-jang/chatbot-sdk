import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
function secret(){return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";}
export function createProactivePreview(botId:string){
  if(!secret())throw new Error("Preview signing unavailable");
  const payload=Buffer.from(JSON.stringify({botId,visitId:randomUUID(),expires:Date.now()+10*60*1000})).toString("base64url");
  return `${payload}.${createHmac("sha256",secret()).update(payload).digest("base64url")}`;
}
export function readProactivePreview(token:unknown,botId:string){
  if(typeof token!=="string"||token.length>1000||!secret())return null;
  try{
    const [payload,signature,...rest]=token.split(".");if(rest.length||!payload||!signature)return null;
    const expected=createHmac("sha256",secret()).update(payload).digest();const actual=Buffer.from(signature,"base64url");
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
    const claims=JSON.parse(Buffer.from(payload,"base64url").toString());
    return claims.botId===botId&&typeof claims.visitId==="string"&&claims.expires>Date.now()?claims as {botId:string;visitId:string;expires:number}:null;
  }catch{return null}
}
