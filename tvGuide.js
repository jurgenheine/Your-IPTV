const axios = require('axios');
const moment = require('moment-timezone');

function unixTimestampToSpecifiedTimezone(timestamp, timezone) {
  // The timestamp is already in UTC, so we just need to format it for the specified timezone
  return moment(timestamp, 'YYYYMMDDHHmmss ZZ').tz(timezone).format('ddd, DD MMM YYYY HH:mm:ss z');
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
  const channels = getElements(xmlData, 'channel')
    .map(channel => ({
      id: getAttribute(channel, 'id'),
      name: getTextContent(getElements(channel, 'display-name')[0] || ''),
      icon: getAttribute(getElements(channel, 'icon')[0] || '', 'src') || ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Process programmes
  const programmes = getElements(xmlData, 'programme')
    .map(programme => ({
      channelId: getAttribute(programme, 'channel'),
      start: getAttribute(programme, 'start'),
      stop: getAttribute(programme, 'stop'),
      title: getTextContent(getElements(programme, 'title')[0] || ''),
      description: getTextContent(getElements(programme, 'desc')[0] || '')
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

  return { channels, programmes };
}

function getCurrentAndNextProgram(programmes, timezone) {
  const now = moment().tz(timezone);

  let currentProgram = null;
  let nextProgram = null;

  for (let i = 0; i < programmes.length; i++) {
    const programStart = moment(programmes[i].start, 'YYYYMMDDHHmmss ZZ');
    const programStop = moment(programmes[i].stop, 'YYYYMMDDHHmmss ZZ');

    if (programStart.isSameOrBefore(now) && programStop.isAfter(now)) {
      currentProgram = programmes[i];
      nextProgram = programmes[i + 1] || null;
      break;
    }
    if (programStart.isAfter(now)) {
      nextProgram = programmes[i];
      break;
    }
  }

  return { 
    currentProgram: currentProgram ? {
      ...currentProgram,
      start: unixTimestampToSpecifiedTimezone(currentProgram.start, timezone),
      stop: unixTimestampToSpecifiedTimezone(currentProgram.stop, timezone)
    } : null,
    nextProgram: nextProgram ? {
      ...nextProgram,
      start: unixTimestampToSpecifiedTimezone(nextProgram.start, timezone),
      stop: unixTimestampToSpecifiedTimezone(nextProgram.stop, timezone)
    } : null
  };
}

async function handleChannelRequest(epgChannelId, baseUrl, username, password, timezone) {
  try {
    const { channels, programmes } = await fetchAndProcessXMLTV(baseUrl, username, password);

    const channelInfo = channels.find(channel => channel.id === epgChannelId);
    if (!channelInfo) {
      return null;
    }

    const channelProgrammes = programmes.filter(programme => programme.channelId === epgChannelId);

    const { currentProgram, nextProgram } = getCurrentAndNextProgram(channelProgrammes, timezone);

    return {
      channel: channelInfo,
      currentProgram: currentProgram,
      nextProgram: nextProgram
    };
  } catch (error) {
    console.error("Error in handleChannelRequest:", error);
    return null;
  }
}

async function handleMultiChannelRequest(channelIdsString, baseUrl, username, password, timezone) {
  try {
    const { channels, programmes } = await fetchAndProcessXMLTV(baseUrl, username, password);

    const channelIds = channelIdsString.split(',');
    const uniqueChannelIds = [...new Set(channelIds)]; // Remove duplicates

    const responseData = uniqueChannelIds.map(channelId => {
      const channelInfo = channels.find(channel => channel.id === channelId);
      if (!channelInfo) {
        return { channelId, error: 'Channel not found' };
      }

      const channelProgrammes = programmes.filter(programme => programme.channelId === channelId);
      const { currentProgram, nextProgram } = getCurrentAndNextProgram(channelProgrammes, timezone);

      return {
        channel: channelInfo,
        currentProgram: currentProgram,
        nextProgram: nextProgram
      };
    });

    return responseData;
  } catch (error) {
    console.error("Error in handleMultiChannelRequest:", error);
    throw new Error('Error processing XMLTV data: ' + error.message);
  }
}

async function handleChannelsListRequest(baseUrl, username, password) {
  try {
    const { channels } = await fetchAndProcessXMLTV(baseUrl, username, password);
    return channels;
  } catch (error) {
    console.error("Error in handleChannelsListRequest:", error);
    throw new Error('Error fetching channels list: ' + error.message);
  }
}

async function getEpgInfoBatch(channelIds, baseUrl, username, password, timezone) {
  try {
    const { channels, programmes } = await fetchAndProcessXMLTV(baseUrl, username, password);

    const results = {};
    for (const channel of channelIds) {
      if (!channel.epg_channel_id) {
        continue;
      }

      const channelInfo = channels.find(c => c.id === channel.epg_channel_id);
      if (!channelInfo) {
        continue;
      }

      const channelProgrammes = programmes.filter(programme => programme.channelId === channel.epg_channel_id);
      const { currentProgram, nextProgram } = getCurrentAndNextProgram(channelProgrammes, timezone);

      results[channel.stream_id] = {
        channel: channelInfo,
        currentProgram: currentProgram,
        nextProgram: nextProgram
      };
    }

    return results;
  } catch (error) {
    console.error("Error in getEpgInfoBatch:", error);
    throw new Error('Error processing XMLTV data: ' + error.message);
  }
}

module.exports = {
  handleChannelRequest,
  handleChannelsListRequest,
  handleMultiChannelRequest,
  getEpgInfoBatch
};
