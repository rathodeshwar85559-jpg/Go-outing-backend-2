import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

app.post("/suggestions", async (req, res) => {
  const { location, date, budget, outingType, mode } = req.body;

  // Call OpenAI with your backend key
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a trip planner AI." },
        { role: "user", content: `Suggest outings in ${location} on ${date} for ${mode}, budget ${budget}, type ${outingType}.` }
      ]
    })
  });

  const data = await response.json();
  res.json(data);
});

app.listen(3000, () => console.log("Server running"));
