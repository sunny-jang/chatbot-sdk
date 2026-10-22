import LoginClient from "./LoginClient";
import {customerReturnPath} from "@/lib/customer-portal/return-path";
export default async function CustomerLoginPage({searchParams}:{searchParams:Promise<{next?:string;error?:string}>}) {
  const query = await searchParams;
  return <LoginClient agencyOrigin={process.env.AUTH_URL || ""} next={customerReturnPath(query.next)} googleAvailable={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} oauthError={Boolean(query.error)} />;
}
