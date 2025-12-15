/**
 * AI service for generating company_details HTML.
 * Same model env + same output rules as your current server.js.
 */

const OpenAI = require('openai');
const { OPENAI_MODEL } = require('../config/appConfig');

let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function generateCompanyDetailsHTML({ companyName, summary, industry, area, existing }) {
    if (!openai) {
        const err = new Error('AI is not configured (missing OPENAI_API_KEY).');
        err.code = 'AI_NOT_CONFIGURED';
        throw err;
    }

    const safeCompanyName = companyName || 'This company';
    const safeSummary = summary || '';
    const safeIndustry = industry || '';
    const safeArea = area || '';
    const safeExisting = existing || '';

    const userPrompt = `
Company name: ${safeCompanyName}
What they do / short summary: ${safeSummary}
Industry / vertical: ${safeIndustry}
Service area / region: ${safeArea}

Existing description (if any):
${safeExisting}

Write a short marketing-style HTML snippet for the company website "About" section:

- Use only basic HTML tags (<p>, <strong>, <em>, <ul>, <li>, <br>).
- Do NOT include <html>, <head>, <body> or <div id="..."> wrappers.
- Make it 2–4 short paragraphs and/or one short bullet list.
- Tone: professional, clear, and compliant for telecom/technology services.
- Do NOT mention AI, prompts, OpenAI, or that this text was generated.
  `.trim();

    const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
            {
                role: 'system',
                content:
                    'You are a copywriter creating HTML snippets for a business website. You return only HTML fragments, no explanations.'
            },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_completion_tokens: 500
    });

    return (completion.choices[0].message.content || '').trim();
}

module.exports = { generateCompanyDetailsHTML };
