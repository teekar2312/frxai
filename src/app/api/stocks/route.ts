import { NextRequest, NextResponse } from "next/server"
import logger from "@/lib/trading-logger"

// Indonesian stock watchlist with realistic IDR prices
interface StockData {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  marketCap: number
  high: number
  low: number
  open: number
  prevClose: number
  sector: string
}

const STOCK_WATCHLIST: StockData[] = [
  {
    symbol: "BBCA",
    name: "Bank Central Asia Tbk",
    price: 9875,
    change: 125,
    changePercent: 1.28,
    volume: 28450000,
    marketCap: 1188.5,
    high: 9925,
    low: 9750,
    open: 9775,
    prevClose: 9750,
    sector: "Banking",
  },
  {
    symbol: "BBRI",
    name: "Bank Rakyat Indonesia Tbk",
    price: 5475,
    change: -50,
    changePercent: -0.91,
    volume: 45200000,
    marketCap: 825.3,
    high: 5550,
    low: 5450,
    open: 5525,
    prevClose: 5525,
    sector: "Banking",
  },
  {
    symbol: "TLKM",
    name: "Telekomunikasi Indonesia Tbk",
    price: 3890,
    change: 40,
    changePercent: 1.04,
    volume: 35800000,
    marketCap: 381.2,
    high: 3920,
    low: 3850,
    open: 3860,
    prevClose: 3850,
    sector: "Telecommunication",
  },
  {
    symbol: "ASII",
    name: "Astra International Tbk",
    price: 5150,
    change: -75,
    changePercent: -1.44,
    volume: 18700000,
    marketCap: 208.7,
    high: 5250,
    low: 5125,
    open: 5225,
    prevClose: 5225,
    sector: "Conglomerate",
  },
  {
    symbol: "UNVR",
    name: "Unilever Indonesia Tbk",
    price: 2890,
    change: 30,
    changePercent: 1.05,
    volume: 8200000,
    marketCap: 109.8,
    high: 2920,
    low: 2860,
    open: 2870,
    prevClose: 2860,
    sector: "Consumer Goods",
  },
  {
    symbol: "BMRI",
    name: "Bank Mandiri Tbk",
    price: 6250,
    change: 100,
    changePercent: 1.63,
    volume: 22100000,
    marketCap: 592.8,
    high: 6300,
    low: 6150,
    open: 6175,
    prevClose: 6150,
    sector: "Banking",
  },
  {
    symbol: "GOTO",
    name: "GoTo Gojek Tokopedia Tbk",
    price: 82,
    change: 3,
    changePercent: 3.80,
    volume: 325000000,
    marketCap: 93.8,
    high: 84,
    low: 79,
    open: 80,
    prevClose: 79,
    sector: "Technology",
  },
  {
    symbol: "BRIS",
    name: "Bank Syariah Indonesia Tbk",
    price: 2580,
    change: -20,
    changePercent: -0.77,
    volume: 15200000,
    marketCap: 164.1,
    high: 2620,
    low: 2565,
    open: 2600,
    prevClose: 2600,
    sector: "Banking",
  },
  {
    symbol: "ICBP",
    name: "Indofood CBP Sukses Makmur Tbk",
    price: 11250,
    change: 150,
    changePercent: 1.35,
    volume: 5200000,
    marketCap: 131.6,
    high: 11300,
    low: 11100,
    open: 11150,
    prevClose: 11100,
    sector: "Consumer Goods",
  },
  {
    symbol: "BBNI",
    name: "Bank Negara Indonesia Tbk",
    price: 4825,
    change: 50,
    changePercent: 1.05,
    volume: 31200000,
    marketCap: 311.8,
    high: 4850,
    low: 4775,
    open: 4780,
    prevClose: 4775,
    sector: "Banking",
  },
  {
    symbol: "ANTM",
    name: "Aneka Tambang Tbk",
    price: 1655,
    change: -25,
    changePercent: -1.49,
    volume: 38900000,
    marketCap: 40.6,
    high: 1690,
    low: 1645,
    open: 1680,
    prevClose: 1680,
    sector: "Mining",
  },
  {
    symbol: "TINS",
    name: "Timah Tbk",
    price: 1780,
    change: 45,
    changePercent: 2.59,
    volume: 9800000,
    marketCap: 26.4,
    high: 1800,
    low: 1735,
    open: 1740,
    prevClose: 1735,
    sector: "Mining",
  },
  {
    symbol: "PGAS",
    name: "Perusahaan Gas Negara Tbk",
    price: 2570,
    change: 20,
    changePercent: 0.78,
    volume: 11500000,
    marketCap: 61.7,
    high: 2590,
    low: 2550,
    open: 2555,
    prevClose: 2550,
    sector: "Energy",
  },
  {
    symbol: "WSKT",
    name: "Waskita Karya Tbk",
    price: 485,
    change: 10,
    changePercent: 2.11,
    volume: 42300000,
    marketCap: 15.1,
    high: 490,
    low: 475,
    open: 478,
    prevClose: 475,
    sector: "Infrastructure",
  },
  {
    symbol: "ADRO",
    name: "Adaro Energy Indonesia Tbk",
    price: 2980,
    change: -35,
    changePercent: -1.16,
    volume: 22500000,
    marketCap: 73.9,
    high: 3025,
    low: 2965,
    open: 3015,
    prevClose: 3015,
    sector: "Mining",
  },
  {
    symbol: "EMTK",
    name: "Elang Mahkota Teknologi Tbk",
    price: 555,
    change: -5,
    changePercent: -0.89,
    volume: 18900000,
    marketCap: 28.0,
    high: 565,
    low: 550,
    open: 560,
    prevClose: 560,
    sector: "Media",
  },
  {
    symbol: "INKP",
    name: "Indah Kiat Pulp & Paper Tbk",
    price: 8150,
    change: 100,
    changePercent: 1.24,
    volume: 3200000,
    marketCap: 55.8,
    high: 8200,
    low: 8050,
    open: 8075,
    prevClose: 8050,
    sector: "Industrial",
  },
  {
    symbol: "MEDC",
    name: "Medco Energi Internasional Tbk",
    price: 1350,
    change: 15,
    changePercent: 1.12,
    volume: 14300000,
    marketCap: 30.1,
    high: 1365,
    low: 1335,
    open: 1340,
    prevClose: 1335,
    sector: "Energy",
  },
  {
    symbol: "SMGR",
    name: "Semen Indonesia Tbk",
    price: 10450,
    change: -75,
    changePercent: -0.71,
    volume: 4500000,
    marketCap: 51.9,
    high: 10550,
    low: 10400,
    open: 10525,
    prevClose: 10525,
    sector: "Industrial",
  },
  {
    symbol: "JSMR",
    name: "Jasa Marga Tbk",
    price: 3690,
    change: 25,
    changePercent: 0.68,
    volume: 9200000,
    marketCap: 41.7,
    high: 3710,
    low: 3660,
    open: 3670,
    prevClose: 3665,
    sector: "Infrastructure",
  },
]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get("symbol")
    const sector = searchParams.get("sector")

    let filtered = [...STOCK_WATCHLIST]

    if (symbol) {
      filtered = filtered.filter(
        (s) =>
          s.symbol.toLowerCase().includes(symbol.toLowerCase()) ||
          s.name.toLowerCase().includes(symbol.toLowerCase())
      )
    }

    if (sector) {
      filtered = filtered.filter((s) => s.sector.toLowerCase() === sector.toLowerCase())
    }

    // Add slight random variation to simulate live data
    const live = filtered.map((stock) => {
      const jitter = (Math.random() - 0.5) * 0.4
      const adjustedPrice = Math.round(stock.price * (1 + jitter / 100))
      const adjustedChange = adjustedPrice - stock.prevClose
      return {
        ...stock,
        price: adjustedPrice,
        change: adjustedChange,
        changePercent: Math.round((adjustedChange / stock.prevClose) * 10000) / 100,
        lastUpdated: new Date().toISOString(),
      }
    })

    return NextResponse.json({ success: true, data: live })
  } catch (error) {
    logger.error('API', 'Error fetching stocks', { details: String(error) })
    return NextResponse.json(
      { success: false, error: "Failed to fetch stocks" },
      { status: 500 }
    )
  }
}
