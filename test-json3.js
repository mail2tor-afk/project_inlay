const https = require('https');
const videoId = 'ABKyi7EvNUk';

https.get('https://www.youtube.com/watch?v=' + videoId, (res) => {
  let html = '';
  res.on('data', chunk => html += chunk);
  res.on('end', () => {
    const startStr = '"captions":{';
    const startIndex = html.indexOf(startStr);
    if (startIndex === -1) {
       console.log('No captions block found'); return;
    }
    
    let braceCount = 0;
    let jsonStr = '';
    let started = false;
    
    for (let i = startIndex + 11; i < html.length; i++) {
      const char = html[i];
      jsonStr += char;
      if (char === '{') { started = true; braceCount++; }
      else if (char === '}') { braceCount--; }
      
      if (started && braceCount === 0) break;
    }
    
    const parsed = JSON.parse(jsonStr);
    const tracks = parsed.playerCaptionsTracklistRenderer.captionTracks;
    const track = tracks.find(t => t.languageCode === 'en' || t.languageCode === 'th') || tracks[0];
    
    const fetchUrl = track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
    console.log('Fetching:', fetchUrl);
    
    https.get(fetchUrl, (res2) => {
       let transcriptData = '';
       res2.on('data', chunk => transcriptData += chunk);
       res2.on('end', () => {
          try {
             const tParsed = JSON.parse(transcriptData);
             console.log('Events found:', tParsed.events.length);
             const firstText = tParsed.events[1].segs.map(s=>s.utf8).join('');
             console.log('Sample text:', firstText);
          } catch(e) {
             console.log('Error parsing JSON3:', e.message);
             console.log('Raw response:', transcriptData.substring(0, 200));
          }
       });
    });
  });
});
