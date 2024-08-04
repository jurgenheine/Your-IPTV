const axios = require('axios');

let cachedChannels = null;
let cachedProgrammes = null;
let lastFetchTime = 0;
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

function unixTimestampToGMT(timestamp) {
  const year = timestamp.substr(0, 4);
  const month = timestamp.substr(4, 2);
  const day = timestamp.substr(6, 2);
  const hour = timestamp.substr(8, 2);
  const minute = timestamp.substr(10, 2);
  const second = timestamp.substr(12, 2);
  const offset = timestamp.substr(15);

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  const offsetHours = parseInt(offset.substr(1, 2));
  const offsetMinutes = parseInt(offset.substr(3, 2));
  const offsetMilliseconds = (offsetHours * 60 + offsetMinutes) * 60 * 1000;
  if (offset.startsWith('+')) {
    date.setTime(date.getTime() - offsetMilliseconds);
  } else {
    date.setTime(date.getTime() + offsetMilliseconds);
  }

  return date.toUTCString();
}

async function fetchAndProcessXMLTV(baseUrl, username, password) {
  const xmltvUrl = `${baseUrl}/xmltv.php?username=${username}&password=${password}`;
  const response = await axios.get(xmltvUrl);
  const xmlData = response.data;

  function getElements(xml, tag) {
    const regex = new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 'gs');
    return Array.from(xml.matchAll(regex)).map(match => match[0]);
  }

  function getAttribute(element, attr) {
    const match = element.match(new RegExp(`${attr}="([^"]*)"`, 'i'));
    return match ? match[1] : null;
  }

  function getTextContent(element) {
    const match = element.match(/>([^<]*)</s);
    return match ? match[1].trim() : '';
  }

  // Process channels
  cachedChannels = getElements(xmlData, 'channel')
    .map(channel => ({
      id: getAttribute(channel, 'id'),
      name: getTextContent(getElements(channel, 'display-name')[0] || ''),
      icon: getAttribute(getElements(channel, 'icon')[0] || '', 'src') || ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Process programmes
  cachedProgrammes = getElements(xmlData, 'programme')
    .map(programme => ({
      channelId: getAttribute(programme, 'channel'),
      start: getAttribute(programme, 'start'),
      stop: getAttribute(programme, 'stop'),
      title: getTextContent(getElements(programme, 'title')[0] || ''),
      description: getTextContent(getElements(programme, 'desc')[0] || '')
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

  lastFetchTime = Date.now();
}

async function ensureDataIsFresh(baseUrl, username, password) {
  const currentTime = Date.now();
  if (!cachedChannels || !cachedProgrammes || currentTime - lastFetchTime > CACHE_DURATION) {
    await fetchAndProcessXMLTV(baseUrl, username, password);
  }
}

function getCurrentAndNextProgram(programmes) {
  const now = new Date();
  now.setHours(now.getHours() + 1); // Add 1 hour

  const currentTimestamp = now.getUTCFullYear() +
    (now.getUTCMonth() + 1).toString().padStart(2, '0') +
    now.getUTCDate().toString().padStart(2, '0') +
    now.getUTCHours().toString().padStart(2, '0') +
    now.getUTCMinutes().toString().padStart(2, '0') +
    now.getUTCSeconds().toString().padStart(2, '0') +
    ' +0000';

  let currentProgram = null;
  let nextProgram = null;

  for (let i = 0; i < programmes.length; i++) {
    if (programmes[i].start <= currentTimestamp && programmes[i].stop > currentTimestamp) {
      currentProgram = programmes[i];
      nextProgram = programmes[i + 1] || null;
      break;
    }
    if (programmes[i].start > currentTimestamp) {
      nextProgram = programmes[i];
      break;
    }
  }

  return { 
    currentProgram: currentProgram ? {
      ...currentProgram,
      start: unixTimestampToGMT(currentProgram.start),
      stop: unixTimestampToGMT(currentProgram.stop)
    } : null,
    nextProgram: nextProgram ? {
      ...nextProgram,
      start: unixTimestampToGMT(nextProgram.start),
      stop: unixTimestampToGMT(nextProgram.stop)
    } : null
  };
}

async function handleChannelRequest(epgChannelId, baseUrl, username, password) {
  try {
    await ensureDataIsFresh(baseUrl, username, password);

    const channelInfo = cachedChannels.find(channel => channel.id === epgChannelId);
    if (!channelInfo) {
      return null;
    }

    const channelProgrammes = cachedProgrammes.filter(programme => programme.channelId === epgChannelId);

    const { currentProgram, nextProgram } = getCurrentAndNextProgram(channelProgrammes);

    return {
      channel: channelInfo,
      currentProgram: currentProgram,
      nextProgram: nextProgram
    };
  } catch (error) {
    return null;
  }
}

async function handleMultiChannelRequest(channelIdsString, baseUrl, username, password) {
  try {
    await ensureDataIsFresh(baseUrl, username, password);

    const channelIds = channelIdsString.split(',');
    const uniqueChannelIds = [...new Set(channelIds)]; // Remove duplicates

    const responseData = uniqueChannelIds.map(channelId => {
      const channelInfo = cachedChannels.find(channel => channel.id === channelId);
      if (!channelInfo) {
        return { channelId, error: 'Channel not found' };
      }

      const channelProgrammes = cachedProgrammes.filter(programme => programme.channelId === channelId);
      const { currentProgram, nextProgram } = getCurrentAndNextProgram(channelProgrammes);

      return {
        channel: channelInfo,
        currentProgram: currentProgram,
        nextProgram: nextProgram
      };
    });

    return responseData;
  } catch (error) {
    throw new Error('Error processing XMLTV data: ' + error.message);
  }
}

async function handleChannelsListRequest(baseUrl, username, password) {
  try {
    await ensureDataIsFresh(baseUrl, username, password);
    return cachedChannels;
  } catch (error) {
    throw new Error('Error fetching channels list: ' + error.message);
  }
}

async function getEpgInfoBatch(channelIds, baseUrl, username, password) {
  try {
    await ensureDataIsFresh(baseUrl, username, password);

    const results = {};
    for (const channel of channelIds) {
      if (!channel.epg_channel_id) {
        continue;
      }

      const channelInfo = cachedChannels.find(c => c.id === channel.epg_channel_id);
      if (!channelInfo) {
        continue;
      }

      const channelProgrammes = cachedProgrammes.filter(programme => programme.channelId === channel.epg_channel_id);
      const { currentProgram, nextProgram } = getCurrentAndNextProgram(channelProgrammes);

      results[channel.stream_id] = {
        channel: channelInfo,
        currentProgram: currentProgram,
        nextProgram: nextProgram
      };
    }

    return results;
  } catch (error) {
    throw new Error('Error processing XMLTV data: ' + error.message);
  }
}

module.exports = {
  handleChannelRequest,
  handleChannelsListRequest,
  handleMultiChannelRequest,
  getEpgInfoBatch
};