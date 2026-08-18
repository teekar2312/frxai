import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    tradingConfig: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/safe-log', () => ({
  safeLog: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn() },
  })),
}));

import { db } from '@/lib/db';
import { getEmailConfig } from '@/lib/email-service';

describe('Email Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
    process.env.NOTIFICATION_EMAIL_TO = 'test@example.com';
    process.env.NOTIFICATION_EMAIL_FROM = 'noreply@example.com';
  });

  it('should return not ready when no RESEND_API_KEY', async () => {
    delete process.env.RESEND_API_KEY;
    (db.tradingConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifyEmail: null,
      emailOnPositionOpen: false,
      emailOnPositionClose: false,
      emailOnAlertTrigger: true,
    });
    const config = await getEmailConfig();
    expect(config.isReady).toBe(false);
  });

  it('should return not ready when no target email', async () => {
    delete process.env.NOTIFICATION_EMAIL_TO;
    (db.tradingConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifyEmail: null,
    });
    const config = await getEmailConfig();
    expect(config.isReady).toBe(false);
  });

  it('should be ready when both key and email are set', async () => {
    (db.tradingConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifyEmail: null,
    });
    const config = await getEmailConfig();
    expect(config.isReady).toBe(true);
    expect(config.targetEmail).toBe('test@example.com');
  });

  it('should prefer DB notifyEmail over env NOTIFICATION_EMAIL_TO', async () => {
    (db.tradingConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifyEmail: 'custom@example.com',
    });
    const config = await getEmailConfig();
    expect(config.targetEmail).toBe('custom@example.com');
  });

  it('should respect per-event toggles', async () => {
    (db.tradingConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifyEmail: 'test@example.com',
      emailOnPositionOpen: true,
      emailOnPositionClose: false,
      emailOnAlertTrigger: true,
    });
    const config = await getEmailConfig();
    expect(config.toggles.positionOpen).toBe(true);
    expect(config.toggles.positionClose).toBe(false);
    expect(config.toggles.alertTrigger).toBe(true);
  });
});
