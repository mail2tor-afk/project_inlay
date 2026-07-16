import { addDocumentToRag } from './rag.service.js';

/**
 * Scrapes clean text from a news agency URL
 */
export const scrapeNewsLink = async (url) => {
  try {
    console.log(`[Scraper] Fetching URL: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // Simple HTML content extraction: strip scripts, styles, and extract text inside p tags
    const cleanText = extractTextFromHtml(html);
    
    if (cleanText.length < 50) {
      throw new Error('Could not extract meaningful content from the page.');
    }

    // Determine article title
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : `ข่าวด่วน (${new Date().toLocaleDateString('th-TH')})`;

    // Insert into RAG
    const result = await addDocumentToRag(title, cleanText, 'link');
    return { title, text: cleanText, chunksCreated: result ? result.count : 0 };
  } catch (error) {
    console.error('[Scraper] Failed to scrape news link:', error);
    throw error;
  }
};

/**
 * Trigger Auto-Scraper to scrape recent fact-checks from Cofact Thailand RSS feed
 */
export const runAutoFactCheckScraper = async () => {
  const feedUrl = 'https://blog.cofact.org/feed/';
  console.log(`[Scraper] Launching Auto-Scraper to fetch feed: ${feedUrl}`);

  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'FactCheck-AI-Agent/1.0' }
    });

    if (!response.ok) {
      throw new Error(`Feed request failed: ${response.status}`);
    }

    const xml = await response.text();
    
    // Parse RSS XML using regex
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let scrapedCount = 0;
    const articles = [];

    // Scan up to 5 newest articles to avoid API rate limit avalanche
    while ((match = itemRegex.exec(xml)) !== null && scrapedCount < 5) {
      const itemContent = match[1];
      
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/i);
      const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/i);
      
      if (titleMatch && linkMatch) {
        const title = titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/i, '$1').trim();
        const link = linkMatch[1].trim();
        
        let desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/i, '$1').trim() : '';
        desc = stripHtmlTags(desc);

        articles.push({ title, link, desc });
        scrapedCount++;
      }
    }

    console.log(`[Scraper] Extracted ${articles.length} news items. Processing embeddings...`);

    let ingestedCount = 0;
    for (const article of articles) {
      // Create a unified RAG context block
      const fullText = `หัวข้อข่าว: ${article.title}\nสรุปข่าว: ${article.desc}\nแหล่งอ้างอิง: ${article.link}`;
      
      // Check if this article already exists to prevent duplicate embeddings
      const { getRagDocuments } = await import('./rag.service.js');
      const currentDocs = getRagDocuments();
      const isDuplicate = currentDocs.some(doc => doc.title.includes(article.title));

      if (isDuplicate) {
        console.log(`[Scraper] Skipping duplicate article: ${article.title}`);
        continue;
      }

      await addDocumentToRag(article.title, fullText, 'auto-scraper');
      ingestedCount++;
      // Cooldown between embeds to prevent Gemini 429
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[Scraper] Ingested ${ingestedCount} new fact-check items into RAG.`);
    return { success: true, count: ingestedCount };
  } catch (error) {
    console.error('[Scraper] Auto-scraping failed:', error);
    throw error;
  }
};

/**
 * Strips HTML tags and script elements
 */
function extractTextFromHtml(html) {
  // Strip head, script, style tags
  let clean = html.replace(/<head>[\s\S]*?<\/head>/gi, '');
  clean = clean.replace(/<script[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
  
  // Extract texts inside p tags
  const pRegex = /<p>([\s\S]*?)<\/p>/gi;
  let match;
  let paragraphs = [];
  while ((match = pRegex.exec(clean)) !== null) {
    const text = stripHtmlTags(match[1]).trim();
    if (text.length > 20) {
      paragraphs.push(text);
    }
  }

  // Fallback to basic tag stripping if no paragraphs found
  if (paragraphs.length === 0) {
    return stripHtmlTags(clean).replace(/\s+/g, ' ').trim();
  }

  return paragraphs.join('\n\n');
}

function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"');
}
