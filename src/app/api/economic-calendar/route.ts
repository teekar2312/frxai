import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateAuth } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';

interface GeneratedEvent {
  date: Date;
  time: string;
  currency: string;
  impact: 'high' | 'medium' | 'low';
  title: string;
  forecast: string | null;
  previous: string | null;
  category: string;
}

// Known recurring economic events with their schedule patterns
interface RecurringEvent {
  title: string;
  currency: string;
  category: string;
  impact: 'high' | 'medium' | 'low';
  // Schedule: 'first_friday', 'mid_month', 'weekly', 'monthly', 'quarterly'
  schedule: string;
  dayOfMonth?: number; // For monthly events
  dayOfWeek?: number;  // 0=Sun, 1=Mon, ..., 6=Sat
  weekOfMonth?: number; // 1=first, 2=second, etc.
  time: string;
  forecastBase: string;
  previousBase: string;
}

const RECURRING_EVENTS: RecurringEvent[] = [
  // US Events
  { title: 'Non-Farm Payrolls', currency: 'USD', category: 'Employment', impact: 'high', schedule: 'first_friday', time: '13:30', forecastBase: '180K', previousBase: '175K' },
  { title: 'Unemployment Rate', currency: 'USD', category: 'Employment', impact: 'high', schedule: 'first_friday', time: '13:30', forecastBase: '3.7%', previousBase: '3.8%' },
  { title: 'FOMC Interest Rate Decision', currency: 'USD', category: 'Interest Rate', impact: 'high', schedule: 'mid_month', dayOfWeek: 3, weekOfMonth: 2, time: '19:00', forecastBase: '5.25%', previousBase: '5.25%' },
  { title: 'CPI (YoY)', currency: 'USD', category: 'Inflation', impact: 'high', schedule: 'monthly', dayOfMonth: 12, time: '13:30', forecastBase: '3.2%', previousBase: '3.4%' },
  { title: 'Core CPI (MoM)', currency: 'USD', category: 'Inflation', impact: 'high', schedule: 'monthly', dayOfMonth: 12, time: '13:30', forecastBase: '0.3%', previousBase: '0.2%' },
  { title: 'GDP (QoQ)', currency: 'USD', category: 'GDP', impact: 'high', schedule: 'quarterly', dayOfMonth: 25, time: '13:30', forecastBase: '2.1%', previousBase: '1.9%' },
  { title: 'ISM Manufacturing PMI', currency: 'USD', category: 'PMI', impact: 'high', schedule: 'monthly', dayOfMonth: 1, time: '15:00', forecastBase: '49.5', previousBase: '48.7' },
  { title: 'ISM Services PMI', currency: 'USD', category: 'PMI', impact: 'high', schedule: 'monthly', dayOfMonth: 5, time: '15:00', forecastBase: '52.5', previousBase: '51.4' },
  { title: 'Retail Sales (MoM)', currency: 'USD', category: 'Retail Sales', impact: 'medium', schedule: 'monthly', dayOfMonth: 15, time: '13:30', forecastBase: '0.4%', previousBase: '0.6%' },
  { title: 'PPI (MoM)', currency: 'USD', category: 'Inflation', impact: 'medium', schedule: 'monthly', dayOfMonth: 13, time: '13:30', forecastBase: '0.1%', previousBase: '0.2%' },
  { title: 'Jobless Claims', currency: 'USD', category: 'Employment', impact: 'medium', schedule: 'weekly', dayOfWeek: 4, time: '13:30', forecastBase: '220K', previousBase: '215K' },
  { title: 'Consumer Confidence', currency: 'USD', category: 'Business', impact: 'medium', schedule: 'monthly', dayOfMonth: 25, time: '15:00', forecastBase: '100.0', previousBase: '99.1' },
  { title: 'Durable Goods Orders', currency: 'USD', category: 'Business', impact: 'medium', schedule: 'monthly', dayOfMonth: 24, time: '13:30', forecastBase: '2.5%', previousBase: '-2.1%' },
  { title: 'New Home Sales', currency: 'USD', category: 'Housing', impact: 'medium', schedule: 'monthly', dayOfMonth: 23, time: '15:00', forecastBase: '680K', previousBase: '695K' },
  { title: 'Existing Home Sales', currency: 'USD', category: 'Housing', impact: 'medium', schedule: 'monthly', dayOfMonth: 22, time: '15:00', forecastBase: '4.10M', previousBase: '4.14M' },
  // EU Events
  { title: 'ECB Interest Rate Decision', currency: 'EUR', category: 'Interest Rate', impact: 'high', schedule: 'mid_month', dayOfWeek: 4, weekOfMonth: 3, time: '12:45', forecastBase: '4.25%', previousBase: '4.25%' },
  { title: 'ECB Press Conference', currency: 'EUR', category: 'Interest Rate', impact: 'high', schedule: 'mid_month', dayOfWeek: 4, weekOfMonth: 3, time: '13:30', forecastBase: null, previousBase: null },
  { title: 'EU CPI (YoY)', currency: 'EUR', category: 'Inflation', impact: 'high', schedule: 'monthly', dayOfMonth: 31, time: '10:00', forecastBase: '2.6%', previousBase: '2.8%' },
  { title: 'German Manufacturing PMI', currency: 'EUR', category: 'PMI', impact: 'medium', schedule: 'monthly', dayOfMonth: 3, time: '08:30', forecastBase: '42.0', previousBase: '41.0' },
  { title: 'EU GDP (QoQ)', currency: 'EUR', category: 'GDP', impact: 'high', schedule: 'quarterly', dayOfMonth: 30, time: '10:00', forecastBase: '0.2%', previousBase: '0.1%' },
  { title: 'German IFO Business Climate', currency: 'EUR', category: 'Business', impact: 'medium', schedule: 'monthly', dayOfMonth: 24, time: '09:00', forecastBase: '86.5', previousBase: '86.2' },
  // UK Events
  { title: 'BOE Interest Rate Decision', currency: 'GBP', category: 'Interest Rate', impact: 'high', schedule: 'mid_month', dayOfWeek: 4, weekOfMonth: 2, time: '12:00', forecastBase: '5.25%', previousBase: '5.25%' },
  { title: 'UK CPI (YoY)', currency: 'GBP', category: 'Inflation', impact: 'high', schedule: 'monthly', dayOfMonth: 19, time: '07:00', forecastBase: '3.9%', previousBase: '4.0%' },
  { title: 'UK GDP (MoM)', currency: 'GBP', category: 'GDP', impact: 'high', schedule: 'monthly', dayOfMonth: 12, time: '07:00', forecastBase: '0.2%', previousBase: '0.1%' },
  { title: 'UK Manufacturing PMI', currency: 'GBP', category: 'PMI', impact: 'medium', schedule: 'monthly', dayOfMonth: 1, time: '08:30', forecastBase: '46.5', previousBase: '45.8' },
  { title: 'UK Retail Sales (MoM)', currency: 'GBP', category: 'Retail Sales', impact: 'medium', schedule: 'monthly', dayOfMonth: 20, time: '07:00', forecastBase: '0.3%', previousBase: '0.5%' },
  { title: 'UK Employment Change', currency: 'GBP', category: 'Employment', impact: 'medium', schedule: 'monthly', dayOfMonth: 16, time: '07:00', forecastBase: '50K', previousBase: '45K' },
  // Japan Events
  { title: 'BOJ Interest Rate Decision', currency: 'JPY', category: 'Interest Rate', impact: 'high', schedule: 'mid_month', dayOfWeek: 5, weekOfMonth: 2, time: '03:00', forecastBase: '0.10%', previousBase: '0.10%' },
  { title: 'Japan CPI (YoY)', currency: 'JPY', category: 'Inflation', impact: 'high', schedule: 'monthly', dayOfMonth: 21, time: '00:30', forecastBase: '2.8%', previousBase: '2.5%' },
  { title: 'Japan GDP (QoQ)', currency: 'JPY', category: 'GDP', impact: 'high', schedule: 'quarterly', dayOfMonth: 15, time: '00:50', forecastBase: '0.1%', previousBase: '-0.2%' },
  { title: 'Japan Manufacturing PMI', currency: 'JPY', category: 'PMI', impact: 'medium', schedule: 'monthly', dayOfMonth: 1, time: '00:30', forecastBase: '49.8', previousBase: '49.1' },
  { title: 'Japan Trade Balance', currency: 'JPY', category: 'Trade', impact: 'medium', schedule: 'monthly', dayOfMonth: 18, time: '00:50', forecastBase: '-¥300B', previousBase: '-¥275B' },
];

function getFirstFridayOfMonth(year: number, month: number): Date {
  const firstDay = new Date(year, month, 1);
  const dayOfWeek = firstDay.getDay();
  // Friday = 5
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  return new Date(year, month, 1 + daysUntilFriday);
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const firstDay = new Date(year, month, 1);
  const firstOccurrence = (weekday - firstDay.getDay() + 7) % 7;
  const targetDate = 1 + firstOccurrence + (n - 1) * 7;
  return new Date(year, month, targetDate);
}

function generateEconomicEvents(startDate: Date, endDate: Date): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const day = current.getDate();
    const dow = current.getDay();

    for (const event of RECURRING_EVENTS) {
      let eventDate: Date | null = null;

      switch (event.schedule) {
        case 'first_friday': {
          const firstFri = getFirstFridayOfMonth(year, month);
          if (firstFri.getTime() === current.getTime()) {
            eventDate = firstFri;
          }
          break;
        }
        case 'weekly': {
          if (event.dayOfWeek !== undefined && dow === event.dayOfWeek) {
            eventDate = current;
          }
          break;
        }
        case 'monthly': {
          if (event.dayOfMonth !== undefined && day === event.dayOfMonth) {
            eventDate = current;
          }
          break;
        }
        case 'mid_month': {
          if (event.weekOfMonth !== undefined && event.dayOfWeek !== undefined) {
            const nthDay = getNthWeekdayOfMonth(year, month, event.dayOfWeek, event.weekOfMonth);
            if (nthDay.getTime() === current.getTime()) {
              eventDate = current;
            }
          }
          break;
        }
        case 'quarterly': {
          // Only in Mar, Jun, Sep, Dec
          if ([2, 5, 8, 11].includes(month) && event.dayOfMonth !== undefined && day === event.dayOfMonth) {
            eventDate = current;
          }
          break;
        }
      }

      if (eventDate) {
        events.push({
          date: new Date(eventDate),
          time: event.time,
          currency: event.currency,
          impact: event.impact,
          title: event.title,
          forecast: event.forecastBase,
          previous: event.previousBase,
          category: event.category,
        });
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return events;
}

// GET - Return economic events for date range
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const currencyFilter = searchParams.get('currency');

    // Parse start/end dates
    let startDate: Date;
    if (dateParam) {
      const parsed = new Date(dateParam);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 });
      }
      startDate = parsed;
    } else {
      startDate = new Date();
    }
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
    endDate.setHours(23, 59, 59, 999);

    // Generate events
    let events = generateEconomicEvents(startDate, endDate);

    // Filter by currency if requested
    if (currencyFilter) {
      events = events.filter(e => e.currency === currencyFilter.toUpperCase());
    }

    // Sort by date then time
    events.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.time.localeCompare(b.time);
    });

    // Upsert events into DB (clear and reinsert for the period)
    await db.economicEvent.deleteMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
    });

    if (events.length > 0) {
      await db.economicEvent.createMany({
        data: events.map(e => ({
          date: e.date,
          time: e.time,
          currency: e.currency,
          impact: e.impact,
          title: e.title,
          forecast: e.forecast,
          previous: e.previous,
          category: e.category,
          source: 'simulated',
        })),
      });
    }

    // Fetch from DB for consistent response
    const dbEvents = await db.economicEvent.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        ...(currencyFilter ? { currency: currencyFilter.toUpperCase() } : {}),
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });

    safeLog({
      level: 'info',
      route: 'EconomicCalendar',
      message: `Generated ${dbEvents.length} economic events for ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`,
    });

    return NextResponse.json({ events: dbEvents });
  } catch (error) {
    logApiError('EconomicCalendar', error);
    return NextResponse.json({ error: 'Failed to fetch economic calendar' }, { status: 500 });
  }
}
