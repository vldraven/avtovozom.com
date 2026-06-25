import { Manrope } from "next/font/google";

/** Self-hosted через next/font — без блокирующего запроса к fonts.googleapis.com. */
export const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-manrope",
});
