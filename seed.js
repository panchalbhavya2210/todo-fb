import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { tough } from "tough-cookie";

const jar = new tough.CookieJar();
const client = wrapper(axios.create({ jar }));

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nseindia.com/",
  Connection: "keep-alive",
};

// STEP 1 — create session
await client.get("https://www.nseindia.com", { headers });

// STEP 2 — call API
const res = await client.get(
  "https://www.nseindia.com/api/corporates-share-holdings?index=equities&symbol=RELIANCE",
  { headers },
);

console.log(res.data);
