import { redirect } from "next/navigation";

/** Unrecognised paths resolve to the landing page, since the usual cause is a truncated link. */
export default function NotFound() {
  redirect("/");
}
