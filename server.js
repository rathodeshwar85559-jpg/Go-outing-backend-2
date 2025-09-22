// server.js
const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2 syntax
const cors = require('cors');

const app = express();
app.use(cors()); // open for now; restrict to your front-end origin for production
app.use(express.json({ limit: '50kb' }));

const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) {
  console.error('ERROR: OPENAI_API_KEY not set in environment. Set this on Render (or locally).');
}

// small helper to extract JSON inside text if OpenAI returns text around it
function extractJSONFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // Try direct parse first
  try {
    const parsed = JSON.parse(text);
    if (parsed) return parsed;
  } catch (e) {}

  // Try to find the first '[' or '{' and last matching bracket
  const start = text.indexOf('{') >= 0 ? text.indexOf('{') : text.indexOf('[');
  if (start === -1) return null;
  // take substring from start to last close brace
  const lastBrace = text.lastIndexOf('}');
  const lastBracket = text.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end === -1) return null;

  const candidate = text.substring(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // give up
    return null;
  }
}

app.get('/ping', (req, res) => res.json({ ok: true, now: Date.now() }));

app.post('/api/suggestions', async (req, res) => {
  try {
    const { location, date, budget, mode, type } = req.body || {};
    if (!location || !date || !budget || !mode || !type) {
      return res.status(400).json({ error: 'Missing required fields: location, date, budget, mode, type' });
    }

    if (!OPENAI_KEY) {
      return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });
    }

    // Build a strict prompt that forces JSON output
    const systemPrompt = `You are "Go Outing" — an expert, concise outing planner for India.
When asked, produce a JSON array named "suggestions". Each suggestion must be an object with these fields:
- id: string (unique)
- title: short string
- description: short paragraph describing the outing
- estimatedCost: number (in rupees)
- image: URL string (if you cannot provide a real image, return empty string)
- locationDetails: short text about the place (neighbourhood / what's special)
- itinerary: array of short strings (step-by-step plan for the day)
- costBreakdown: array of short strings like "Travel: ₹100, Food: ₹200"
- tips: array of short tips
- bestTime: string (best time/season)
Return **only** valid JSON (no extra commentary). Example structure:

{
  "suggestions": [
    {
      "id":"s1",
      "title":"Charminar & Laad Bazaar Walk",
      "description":"A cultural half-day exploring Charminar and nearby bazaars...",
      "estimatedCost": 800,
      "image": "https://example.com/charminar.jpg",
      "locationDetails": "Old City, Hyderabad. Famous for pearls and biryani.",
      "itinerary": ["Start at Charminar", "Visit Mecca Masjid", "Lunch at local biryani spot"],
      "costBreakdown": ["Transport: ₹100", "Food: ₹400", "Shopping: ₹300"],
      "tips": ["Wear comfortable shoes", "Carry water"],
      "bestTime": "October - March"
    }
  ]
}

Be concise and return 3-6 suggestions tailored to the user's budget, mode, type and date. Assume the user inputs are in India.`;

    const userPrompt = `User request:
location: ${location}
date: ${date}
budget: ${budget}
mode: ${mode}
type: ${type}

Return suggestions as described above.`;

    // Call OpenAI Chat Completions
    const payload = {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 700
    };

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify(payload),
      timeout: 30000
    });

    if (!openaiResp.ok) {
      const txt = await openaiResp.text();
      console.error('OpenAI error:', openaiResp.status, txt);
      return res.status(502).json({ error: 'OpenAI API error', details: txt });
    }

    const openaiJson = await openaiResp.json();
    const content = openaiJson?.choices?.[0]?.message?.content || openaiJson?.choices?.[0]?.text || '';

    // Try to extract JSON
    let parsed = extractJSONFromText(content);
    if (!parsed) {
      // Last resort: return plain text content as one suggestion
      return res.json({
        suggestions: [
          {
            id: 'ai_raw',
            title: 'AI result (raw)',
            description: content.slice(0, 1000),
            estimatedCost: Math.min(budget, 500),
            image: '',
            locationDetails: location,
            itinerary: [],
            costBreakdown: [],
            tips: [],
            bestTime: ''
          }
        ]
      });
    }

    // If top-level object has suggestions field -> use that
    if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
      return res.json({ suggestions: parsed.suggestions });
    }

    // If parsed itself is an array, return it
    if (Array.isArray(parsed)) {
      return res.json({ suggestions: parsed });
    }

    // Otherwise, try to find suggestions inside parsed
    for (const key of ['data','result','output']) {
      if (parsed[key] && Array.isArray(parsed[key])) {
        return res.json({ suggestions: parsed[key] });
      }
    }

    // Fallback: return the object wrapped
    return res.json({ suggestions: Array.isArray(parsed) ? parsed : [parsed] });
  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ error: 'Server error', details: err.message || String(err) });
  }
});

app.listen(PORT, ()=> console.log(`Server started on port ${PORT}`));
