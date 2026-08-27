import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") ?? "20")
    const category = searchParams.get("category")
    const symbol = searchParams.get("symbol")

    const where: Record<string, unknown> = {}
    if (category) where.category = category
    if (symbol) {
      // Search within JSON symbols array using string contains
      where.symbols = { contains: symbol }
    }

    const articles = await db.newsArticle.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: Math.min(limit, 100),
    })

    return NextResponse.json({ success: true, data: articles })
  } catch (error) {
    console.error("Error fetching news:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch news" },
      { status: 500 }
    )
  }
}
