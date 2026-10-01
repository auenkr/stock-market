import { ImageResponse } from "next/og";

export const alt = "Ledgerline — Indian stock market data API for developers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 70, background: "#12231e", color: "#eef5ed", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 32 }}><span style={{ display: "flex", padding: 12, borderRadius: 12, background: "#c9f36b", color: "#12231e", fontWeight: 700 }}>LL</span>Ledgerline</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}><span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -3 }}>Your next financial product.</span><span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -3, color: "#c9f36b" }}>Powered by one API.</span></div>
      <div style={{ fontSize: 25, color: "#b1c2b4" }}>Indian stock market data · Company fundamentals · REST + JSON</div>
    </div>, size,
  );
}
