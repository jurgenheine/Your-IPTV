const axios = require('axios');

function createXtreamModule(xtreamBaseUrl, username, password) {
    const xtreamApiUrl = `${xtreamBaseUrl}/player_api.php`;

    async function getDetailsFromCinemeta(ttnumber, type = 'movie') {
        const url = `https://v3-cinemeta.strem.io/meta/${type}/${ttnumber}.json`;
        try {
            const response = await axios.get(url);
            const { name: title, season, episode } = response.data.meta;
            return { title, season, episode };
        } catch (error) {
            console.error('Error fetching data from Cinemeta:', error);
            throw error;
        }
    }

    async function getVodStreams() {
        const params = { username, password, action: 'get_vod_streams' };
        try {
            const response = await axios.get(xtreamApiUrl, { params });
            return response.data;
        } catch (error) {
            console.error('Error fetching VOD streams from Xtream Codes:', error);
            throw error;
        }
    }

    async function getSeries() {
        const params = { username, password, action: 'get_series' };
        try {
            const response = await axios.get(xtreamApiUrl, { params });
            return response.data;
        } catch (error) {
            console.error('Error fetching series from Xtream Codes:', error);
            throw error;
        }
    }

    async function getSeriesInfo(seriesId) {
        const params = { username, password, action: 'get_series_info', series_id: seriesId };
        try {
            const response = await axios.get(xtreamApiUrl, { params });
            return response.data;
        } catch (error) {
            console.error('Error fetching series info from Xtream Codes:', error);
            throw error;
        }
    }

    function normalizeTitle(title) {
        // Remove the year and any surrounding parentheses or brackets
        let normalized = title.replace(/\s*\([^)]*\)|\s*\[[^\]]*\]|\s*\d{4}$/g, '');
        // Convert to lowercase and remove all non-alphanumeric characters
        normalized = normalized.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalized;
    }

    function findMatchingContent(contentList, title) {
        const normalizedTitle = normalizeTitle(title);
        console.log(`Searching for normalized title: ${normalizedTitle}`);
        
        return contentList.find(item => {
            const itemNormalizedTitle = normalizeTitle(item.name);
            console.log(`Comparing with: ${itemNormalizedTitle}`);
            return itemNormalizedTitle === normalizedTitle;
        });
    }

    function findBestMatchingContent(contentList, title) {
        const normalizedTitle = normalizeTitle(title);
        console.log(`Searching for best match for normalized title: ${normalizedTitle}`);
        
        let bestMatch = null;
        let highestSimilarity = 0;

        contentList.forEach(item => {
            const itemNormalizedTitle = normalizeTitle(item.name);
            const similarity = calculateSimilarity(normalizedTitle, itemNormalizedTitle);
            console.log(`Comparing with: ${itemNormalizedTitle}, Similarity: ${similarity}`);
            
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestMatch = item;
            }
        });

        console.log(`Best match found: ${bestMatch ? bestMatch.name : 'None'} with similarity: ${highestSimilarity}`);
        return highestSimilarity > 0.8 ? bestMatch : null; // Adjust threshold as needed
    }

    function calculateSimilarity(str1, str2) {
        const len = Math.max(str1.length, str2.length);
        const editDistance = levenshteinDistance(str1, str2);
        return 1 - editDistance / len;
    }

    function levenshteinDistance(str1, str2) {
        const m = str1.length;
        const n = str2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(null));

        for (let i = 0; i <= m; i++) {
            dp[i][0] = i;
        }
        for (let j = 0; j <= n; j++) {
            dp[0][j] = j;
        }

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = Math.min(
                        dp[i - 1][j - 1] + 1,
                        dp[i][j - 1] + 1,
                        dp[i - 1][j] + 1
                    );
                }
            }
        }

        return dp[m][n];
    }

    function buildStreamUrl(content) {
        let url;
        if (content.stream_type) {
            // For movies
            url = `${xtreamBaseUrl}/${content.stream_type}/${username}/${password}/${content.stream_id}.${content.container_extension}`;
        } else if (content.id) {
            // For series episodes
            url = `${xtreamBaseUrl}/series/${username}/${password}/${content.id}.${content.container_extension}`;
        }
        console.log('Constructed stream URL:', url);
        return url;
    }

    return async function(input) {
        try {
            const [ttNumber, season, episode] = input.split(':');
            
            const type = ttNumber.startsWith('tt') ? (season && episode ? 'series' : 'movie') : 'series';
            
            const { title } = await getDetailsFromCinemeta(ttNumber, type);
            console.log(`Title from Cinemeta: ${title} (${type})`);

            let contentList, matchingContent, contentInfo, specificEpisode;
            if (type === 'movie') {
                contentList = await getVodStreams();
                matchingContent = findMatchingContent(contentList, title);
                if (!matchingContent) {
                    console.log('Exact match not found, trying best match...');
                    matchingContent = findBestMatchingContent(contentList, title);
                }
                if (matchingContent) {
                    const contentUrl = buildStreamUrl(matchingContent);
                    return { title: matchingContent.name, contentUrl, type };
                } else {
                    console.log(`No matching content found for movie: ${title}`);
                    return null;
                }
            } else {
                contentList = await getSeries();
                matchingContent = findMatchingContent(contentList, title);
                if (!matchingContent) {
                    console.log('Exact match not found, trying best match...');
                    matchingContent = findBestMatchingContent(contentList, title);
                }
                if (matchingContent) {
                    contentInfo = await getSeriesInfo(matchingContent.series_id);
                    if (season && episode) {
                        specificEpisode = contentInfo.episodes[season]?.find(ep => ep.episode_num == episode);
                        if (specificEpisode) {
                            const episodeUrl = buildStreamUrl(specificEpisode);
                            return {
                                title: matchingContent.name,
                                type,
                                seriesId: matchingContent.series_id,
                                season,
                                episode,
                                episodeTitle: specificEpisode.title,
                                contentUrl: episodeUrl
                            };
                        } else {
                            console.log(`Episode not found: ${title} S${season}E${episode}`);
                            return null;
                        }
                    } else {
                        return {
                            title: matchingContent.name,
                            type,
                            seriesId: matchingContent.series_id,
                            seasons: contentInfo.seasons,
                            episodes: contentInfo.episodes
                        };
                    }
                } else {
                    console.log(`No matching content found for series: ${title}`);
                    return null;
                }
            }
        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }
    };
}

module.exports = { createXtreamModule };