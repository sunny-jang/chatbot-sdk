import "./portal.css";
export const metadata = {
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};
export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
