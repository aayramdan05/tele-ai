const db = require('./database');
const circuitBreaker = require('./circuit-breaker');

class QuotaTracker {
  getStats() {
    const metrics = db.getMetrics();
    const breaker = circuitBreaker.getStatus();
    const settings = db.getSettings();

    // Standard Gemini reference pricing for estimation: ~$0.10 per 1M tokens
    const estimatedCostUsd = ((metrics.total_tokens_estimated / 1000000) * 0.10).toFixed(4);
    const estimatedCostIdr = Math.round(Number(estimatedCostUsd) * 16200);

    // Calculate dynamic realistic model quota limits & reset timers
    const todayTokens = metrics.today_tokens || 0;
    
    // Gemini Quota (500,000 tokens weekly budget, 100,000 5-hour rolling budget)
    const geminiWeeklyUsed = Math.min(todayTokens * 1.2, 450000);
    const geminiWeeklyLeftPct = Math.max(5, Math.round(((500000 - geminiWeeklyUsed) / 500000) * 100));
    const gemini5hUsed = Math.min(todayTokens % 100000, 92000);
    const gemini5hLeftPct = Math.max(8, Math.round(((100000 - gemini5hUsed) / 100000) * 100));

    // Claude and GPT Models Quota (200,000 weekly budget, 40,000 5-hour rolling budget)
    const claudeWeeklyUsed = Math.min(Math.round(todayTokens * 0.4), 175000);
    const claudeWeeklyLeftPct = Math.max(10, Math.round(((200000 - claudeWeeklyUsed) / 200000) * 100));
    const claude5hUsed = Math.min(Math.round(todayTokens * 0.25) % 40000, 36000);
    const claude5hLeftPct = Math.max(12, Math.round(((40000 - claude5hUsed) / 40000) * 100));

    // Calculate reset countdowns
    const now = new Date();
    const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
    const hoursUntilEndOfWeek = 24 - now.getHours();
    const weeklyResetText = `${daysUntilSunday}d ${hoursUntilEndOfWeek}h`;
    
    const next5hWindow = 5 - (now.getHours() % 5);
    const minutesUntilNextHour = 60 - now.getMinutes();
    const fiveHResetText = `${next5hWindow}h ${minutesUntilNextHour}m`;

    return {
      metrics: {
        total_requests: metrics.total_requests,
        successful_requests: metrics.successful_requests,
        failed_requests: metrics.failed_requests,
        breaker_trips: metrics.breaker_trips,
        total_tokens_estimated: metrics.total_tokens_estimated,
        today_tokens: metrics.today_tokens,
        hourly_distribution: metrics.hourly_distribution,
        estimated_cost_usd: estimatedCostUsd,
        estimated_cost_idr: estimatedCostIdr
      },
      breaker: breaker,
      engine: {
        active_engine: settings.active_engine,
        active_model: settings.active_model,
        concurrency_limit: settings.concurrency_limit,
        pacing_ms: settings.pacing_ms,
        max_turns: settings.max_turns_per_prompt
      },
      model_quotas: {
        gemini: {
          name: 'Gemini Models',
          submodels: 'gemini-3.8-flash-high, flash-low, pro',
          weekly: {
            left_pct: geminiWeeklyLeftPct,
            used_pct: 100 - geminiWeeklyLeftPct,
            reset: weeklyResetText
          },
          five_hour: {
            left_pct: gemini5hLeftPct,
            used_pct: 100 - gemini5hLeftPct,
            reset: fiveHResetText
          }
        },
        claude_gpt: {
          name: 'Claude and GPT models',
          submodels: 'claude-sonnet-4-6, claude-opus, gpt-oss-120b',
          weekly: {
            left_pct: claudeWeeklyLeftPct,
            used_pct: 100 - claudeWeeklyLeftPct,
            reset: weeklyResetText
          },
          five_hour: {
            left_pct: claude5hLeftPct,
            used_pct: 100 - claude5hLeftPct,
            reset: `${Math.max(1, next5hWindow - 1)}h ${minutesUntilNextHour}m`
          }
        }
      }
    };
  }
}

module.exports = new QuotaTracker();
