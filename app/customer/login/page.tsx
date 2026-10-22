import LoginClient from "./LoginClient";
export default function CustomerLoginPage() {
  return <LoginClient agencyOrigin={process.env.AUTH_URL || ""} />;
}
