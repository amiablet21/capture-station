// Plain-language questions ("when did we last buy the navy S25?") answered
// by Claude with READ-ONLY tools over the bot's own data: stock and 30 days
// of sales (Linnworks), the purchase log, last prices. Claude can look
// things up; it cannot change anything.
import Anthropic from '@anthropic-ai/sdk';
import { shoppingList, isConditionSku } from './report.js';

const MAX_STEPS = 8; // tool rounds per question
const SESSION_IDLE_MS = 30 * 60 * 1000; // a new conversation after 30 quiet minutes
const SESSION_MAX_MESSAGES = 60;

// $ per million tokens [input, output], for the "status" cost estimate only
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
// models that take server-side fallbacks on a refusal (Haiku 5.5 has none)
const takesFallbacks = (model) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

export const SYSTEM_PROMPT = `You are the stock assistant for Digital World Shop (DWS), which resells phones, tablets and other electronics on Walmart, eBay and Temu. You are in a WhatsApp group with the owner and the owner's dad, who does the buying. They ask about stock, sales, purchases and prices.

What you can see, through your tools:
- Every SKU in Linnworks with its stock at the warehouse, at Walmart WFS and due in on purchase orders, refreshed about every 15 minutes.
- Sales for the last 30 days only (per SKU, per day, per marketplace). Older sales are not available to you.
- The purchase log: purchases noted in this chat with "bought SKU qty @ price from seller", since the bot started. Older purchases were never recorded here.
- Last prices: the newer of the item's cost kept in DWS Stock (one current figure, no date of purchase or seller) and the latest noted purchase price.
- The shopping list, worked out like DWS Stock: per day = 30-day units / 30; suggested buy = per day x (lead + cover days) less on hand and due in, rounded up to 5. Statuses: Out of stock, Order now (runs out within the lead time), Order soon, On order, Covered, Not selling, Dropship, Not linked.

How to answer:
- Look things up with the tools before answering. Never invent a number, date, price or seller. If the data doesn't have it, say so plainly; for purchases, add that noting buys with "bought SKU qty @ price from seller" makes this answerable from now on.
- When a product description fits several SKUs (sizes, colours, open box), list them briefly and ask which one, unless the question covers them all.
- You can't change anything: no stock edits, orders or notes. To note a purchase, give the exact "bought ..." line to send.
- This is WhatsApp: keep it short (a few lines), use *bold* and • bullets, no headings, tables or links. Write dates like "Mon, Oct 19".
- Reply in the language the person wrote in.`;

const strictTool = (name, description, properties, required) => ({
  name, description, strict: true,
  input_schema: { type: 'object', properties, required, additionalProperties: false },
});

export const TOOLS = [
  strictTool('find_skus', 'Search SKUs by part of the SKU or the product name (e.g. "s25 navy", "tab a9"). Returns up to 15 matches, best sellers first.',
    { query: { type: 'string', description: 'Words to look for in the SKU or title' } }, ['query']),
  strictTool('get_sku', 'Everything known about one SKU: stock, sales over 7/14/30 days, pace, trend, days left, status, suggested buy, marketplace split, average sale price, last price, open purchase note.',
    { sku: { type: 'string', description: 'The exact SKU' } }, ['sku']),
  strictTool('daily_sales', 'Units sold per day over the last 30 days for one SKU.',
    { sku: { type: 'string', description: 'The exact SKU' } }, ['sku']),
  strictTool('purchase_history', 'Purchases noted in the chat (date, qty, price, seller, who noted it), newest first, plus the cost kept in DWS Stock. Empty sku = the latest purchases of every SKU.',
    { sku: { type: 'string', description: 'The exact SKU, or "" for all' } }, ['sku']),
  strictTool('shopping_list', 'The current shopping list: what to buy and how many, grouped by urgency, with what is already on the way.',
    {}, []),
  strictTool('top_sellers', 'Rank SKUs by sales.',
    {
      by: { type: 'string', enum: ['units_7d', 'units_30d', 'revenue_30d', 'trend_up'], description: 'trend_up = fastest growing over the last 14 days' },
      limit: { type: 'integer', description: 'How many, 1-25' },
    }, ['by', 'limit']),
];

// ---- the tools themselves: pure functions over a snapshot ----
// ctx: { rows, days, purchases, prices (Map), bought }

const upper = (s) => String(s || '').trim().toUpperCase();
const priceOf = (ctx, sku) => {
  const p = ctx.prices.get(upper(sku));
  return p ? { price: p.price, from: p.source === 'bought' ? 'noted purchase' : 'DWS Stock cost', date: p.at.slice(0, 10), seller: p.vendor || undefined } : null;
};
const findRow = (ctx, sku) => ctx.rows.find(r => upper(r.sku) === upper(sku));
const brief = (r) => ({ sku: r.sku, title: r.title, status: r.status, available: r.available, perDay: r.perDay, ...(isConditionSku(r.sku) ? { condition: 'open box / used / scrap' } : {}) });
const notFound = (sku) => ({ error: `No SKU "${sku}". Use find_skus to search.` });

export function runTool(name, input, ctx) {
  switch (name) {
    case 'find_skus': {
      const words = upper(input.query).split(/\s+/).filter(Boolean);
      if (!words.length) return { error: 'Empty search.' };
      const hits = ctx.rows.filter(r => { const hay = `${upper(r.sku)} ${upper(r.title)}`; return words.every(w => hay.includes(w)); });
      hits.sort((a, b) => b.sold30 - a.sold30 || a.sku.localeCompare(b.sku));
      return { matches: hits.length, skus: hits.slice(0, 15).map(brief) };
    }
    case 'get_sku': {
      const r = findRow(ctx, input.sku);
      if (!r) return notFound(input.sku);
      const b = ctx.bought[upper(r.sku)];
      const { series, ...fields } = r; // daily numbers live in daily_sales
      return { ...fields, lastPrice: priceOf(ctx, r.sku), openPurchaseNote: b ? { qty: b.qty, price: b.price, date: b.at.slice(0, 10) } : null };
    }
    case 'daily_sales': {
      const r = findRow(ctx, input.sku);
      if (!r) return notFound(input.sku);
      return { sku: r.sku, days: Object.fromEntries(ctx.days.map((d, i) => [d, r.series[i] || 0])), total: r.sold30 };
    }
    case 'purchase_history': {
      const want = upper(input.sku);
      const list = ctx.purchases.filter(p => !want || upper(p.sku) === want).slice(-30).reverse()
        .map(p => ({ date: p.at.slice(0, 10), sku: p.sku, qty: p.qty, price: p.price, seller: p.vendor || null, notedBy: p.by || null }));
      const cost = want ? ctx.prices.get(want) : null;
      return {
        purchases: list,
        note: list.length ? undefined : 'No purchases noted in the chat for this yet.',
        dwsStockCost: cost && cost.source === 'cost' ? { cost: cost.price, setOn: cost.at.slice(0, 10) } : undefined,
      };
    }
    case 'shopping_list': {
      const l = shoppingList(ctx.rows, ctx.bought);
      const item = (r) => ({ sku: r.sku, title: r.title, buy: r.buy, perDay: r.perDay, onHand: r.onHand, daysLeft: r.daysLeft, due: r.due, lastPrice: priceOf(ctx, r.sku) });
      return {
        outOfStock: l.out.map(item), orderNow: l.now.map(item), orderSoon: l.soon.map(item),
        onTheWay: l.onTheWay.map(r => ({ sku: r.sku, qty: r.bought.qty, price: r.bought.price, date: r.bought.at.slice(0, 10) })),
      };
    }
    case 'top_sellers': {
      const n = Math.min(25, Math.max(1, Number(input.limit) || 10));
      const key = { units_7d: r => r.sold7, units_30d: r => r.sold30, revenue_30d: r => r.revenue,
        trend_up: r => (r.sold30 >= 5 ? r.sold14 / 14 - (r.sold30 - r.sold14) / 16 : -1e9) }[input.by];
      if (!key) return { error: 'by must be units_7d, units_30d, revenue_30d or trend_up' };
      const ranked = ctx.rows.filter(r => r.sold30 > 0 && !isConditionSku(r.sku)).sort((a, b) => key(b) - key(a)).slice(0, n);
      return { by: input.by, skus: ranked.map(r => ({ ...brief(r), sold7: r.sold7, sold30: r.sold30, revenue30: r.revenue, trend: r.trend })) };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

const textOf = (content) => content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

export class Assistant {
  // getContext() → the snapshot the tools read; client is injectable for tests
  constructor({ model, effort, dailyLimit, getContext, client, log = () => {} }) {
    this.model = model;
    this.effort = effort;
    this.dailyLimit = dailyLimit;
    this.getContext = getContext;
    this.client = client || new Anthropic();
    this.log = log;
    this.sessions = new Map(); // chat id → { messages, lastAt }
    this.usage = { day: '', questions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }

  today() {
    const d = new Date();
    const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (this.usage.day !== day) this.usage = { day, questions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    return this.usage;
  }

  costToday() {
    const u = this.today();
    const [inP, outP] = PRICES[this.model] || [0, 0];
    return (u.input * inP + u.cacheWrite * inP * 1.25 + u.cacheRead * inP * 0.1 + u.output * outP) / 1e6;
  }

  // the conversation for a chat. History is only ever appended to (thinking
  // blocks must be sent back exactly as they came); a quiet spell or a long
  // thread starts a fresh conversation instead of trimming the old one.
  session(chatId) {
    const s = this.sessions.get(chatId);
    if (s && Date.now() - s.lastAt < SESSION_IDLE_MS && s.messages.length < SESSION_MAX_MESSAGES) return s;
    const fresh = { messages: [], lastAt: Date.now() };
    this.sessions.set(chatId, fresh);
    return fresh;
  }

  async ask(chatId, question, { who = '', now = new Date() } = {}) {
    const u = this.today();
    if (u.questions >= this.dailyLimit) return `I've answered ${this.dailyLimit} questions today, my daily limit. The commands (list, stock, history) still work.`;
    u.questions++;
    const ctx = this.getContext();
    const ageMin = ctx.dataAt ? Math.round((now.getTime() - ctx.dataAt) / 60000) : null;
    const stamp = `[${now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}${ageMin !== null ? ` · stock figures from ${ageMin} min ago` : ''}${who ? ` · from ${who}` : ''}]`;

    const s = this.session(chatId);
    // work on a copy: a failed question leaves the conversation as it was
    const messages = [...s.messages, { role: 'user', content: `${stamp}\n${question}` }];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const params = {
          model: this.model,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
          output_config: { effort: this.effort },
          cache_control: { type: 'ephemeral' },
        };
        if (takesFallbacks(this.model)) {
          params.betas = ['server-side-fallback-2026-07-01'];
          params.fallbacks = 'default';
        }
        const res = await this.client.beta.messages.create(params);
        const us = res.usage || {};
        u.input += us.input_tokens || 0;
        u.output += us.output_tokens || 0;
        u.cacheRead += us.cache_read_input_tokens || 0;
        u.cacheWrite += us.cache_creation_input_tokens || 0;

        if (res.stop_reason === 'refusal') return "Sorry, I can't help with that one.";
        messages.push({ role: 'assistant', content: res.content });
        if (res.stop_reason === 'pause_turn') continue;
        if (res.stop_reason !== 'tool_use') {
          s.messages = messages;
          s.lastAt = Date.now();
          const text = textOf(res.content);
          return (text || 'Sorry, I lost my train of thought — ask me again?') + (res.stop_reason === 'max_tokens' ? ' …' : '');
        }
        // every tool call of this turn, answered in one message
        const results = [];
        for (const b of res.content.filter(c => c.type === 'tool_use')) {
          let out;
          try { out = runTool(b.name, b.input || {}, ctx); } catch (e) { out = { error: e.message }; }
          this.log(`tool ${b.name} ${JSON.stringify(b.input)}`);
          results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out), ...(out && out.error ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
      }
      return 'That took me too many steps — could you ask it more simply?';
    } catch (e) {
      this.log(`question failed: ${e.message}`);
      if (e instanceof Anthropic.AuthenticationError) return "My AI key isn't working (ANTHROPIC_API_KEY on the server).";
      if (e instanceof Anthropic.RateLimitError) return "I'm busy right now — try again in a minute.";
      if (e instanceof Anthropic.APIConnectionError) return "I can't reach the AI service right now — try again shortly.";
      if (e instanceof Anthropic.APIError) return `The AI service answered with an error (${e.status}) — try again shortly.`;
      return 'Something went wrong answering that.';
    }
  }
}
