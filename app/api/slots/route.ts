import { NextResponse } from "next/server";
import { generateUpcomingSlots } from "@/lib/slots";

export async function GET() {
  return NextResponse.json(generateUpcomingSlots());
}
