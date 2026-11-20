const db = require('./database');
const circuitBreaker = require('./circuit-breaker');

class QuotaTracker {
  getStats() {
    const metrics = db.getMetrics();
    const breaker = circuitBreaker.getStatus();
    const settings = db.getSettings();

    // Standard Gemini 1.5/2.5/Flash pricing reference for estimation: ~$0.075 per 1M tokens
    const estimatedCostUsd = ((metrics.total_tokens_estimated / 1000000) * 0.10).toFixed(4);
    const estimatedCostIdr = Math.round(Number(estimatedCostUsd) * 16200);

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
      }
    };
  }
}

module.exports = new QuotaTracker();
