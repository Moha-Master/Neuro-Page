const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const moment = require('moment-timezone'); // 尽管这里不再用于格式化schedule time，但其他地方可能仍用
const cheerio = require('cheerio');
const sharp = require('sharp');
require('dotenv').config();

// ##############################
//         Config
// ##############################
const CONFIG = {
    TIME_FORMAT: 'MMM D HH:mm [GMT]+8', // 用于JSON中的lastUpdated时间
    // CONFIG.SCHEDULE_TIME_FORMAT 不再用于 schedule 数组中的 time 字段，
    // 因为我们将直接存储 Unix 时间戳，由前端进行格式化。
    CHANNEL_ID: process.env.CHANNEL_ID,
    TOKEN: process.env.DISCORD_TOKEN,
    IMAGE_PATH: path.resolve(__dirname, '../images/schedule.png'),
    WEBP_PATH: path.resolve(__dirname, '../images/schedule.webp'),
    DATA_PATH: path.resolve(__dirname, '../public/data.json'),
    OUTPUT_DIR: path.resolve(__dirname, '../public')
};
moment.locale('en-us');

// ##############################
//        Discord Client
// ##############################
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`🏃 ${client.user.tag} ready.`);
});

/**
 * 查找最新的包含图片的消息，并返回图片URL和消息文本内容。
 * @returns {Promise<{imageUrl: string, messageContent: string}>} 包含图片URL和消息文本内容的对象
 */
async function findLatestImage() {
    try {
        const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
        const messages = await channel.messages.fetch({ limit: 10, order: 'desc' });
        console.log('Messages fetched: ', messages.size);

        for (const message of messages.values()) {
            console.log(`Checking message ${message.id} (created: ${message.createdAt})`);
            let imageUrl = null;
            const messageContent = message.content || ''; // 获取消息文本

            // 1. 检查附件中的图片
            if (message.attachments.size > 0) {
                for (const [_, attachment] of message.attachments) {
                    const isImage = attachment.contentType?.startsWith('image/') ||
                                   ['.png', '.jpg', '.jpeg', '.webp', '.gif'].some(ext =>
                                       attachment.name?.toLowerCase().endsWith(ext));
                    if (isImage) {
                        imageUrl = attachment.url;
                        console.log('✅ Found image in attachments:', imageUrl);
                        return { imageUrl: imageUrl, messageContent: messageContent };
                    }
                }
            }

            // 2. 检查嵌入内容（embeds）中的图片
            if (message.embeds.length > 0) {
                for (const embed of message.embeds) {
                    const embedImageUrl = embed.image?.url || embed.thumbnail?.url;
                    if (embedImageUrl) {
                        imageUrl = embedImageUrl;
                        console.log('✅ Found image in embed:', imageUrl);
                        return { imageUrl: imageUrl, messageContent: messageContent };
                    }
                }
            }

            // 3. 检查消息内容中的直接图片链接
            if (messageContent) {
                const imageUrlMatch = messageContent.match(
                    /https?:\/\/[^\s]+?\.(png|jpg|jpeg|webp|gif)(\?[^\s]+)?/i
                );
                if (imageUrlMatch) {
                    imageUrl = imageUrlMatch[0];
                    console.log('✅ Found image URL in content:', imageUrl);
                    return { imageUrl: imageUrl, messageContent: messageContent };
                }
            }
        }
        throw new Error('No image found in the last 10 messages.');
    } catch (error) {
        console.error('🚨 Error scanning messages:', error.message);
        process.exit(1);
    }
}

// ##############################
//        Files
// ##############################
async function downloadFile(url) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'arraybuffer'
        });
        if (!fs.existsSync(path.dirname(CONFIG.IMAGE_PATH))) {
            fs.mkdirSync(path.dirname(CONFIG.IMAGE_PATH), { recursive: true });
        }
        fs.writeFileSync(CONFIG.IMAGE_PATH, response.data);
        await sharp(response.data)
            .webp({
                quality: 80,
                lossless: false
            })
            .toFile(CONFIG.WEBP_PATH);
        console.log('✅ Picture updated and converted to WebP');
        console.log('Image URL: ', `${url}`);
        return true;
    } catch (error) {
        console.error('Download or conversion failed:', error.message);
        return false;
    }
}

// ##############################
//        Followers
// ##############################
async function getTwitchFollowers() {
    try {
        const { data } = await axios.get('https://twitchtracker.com/vedal987', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            },
        });
        const $ = cheerio.load(data);
        const followersElement = $('div.g-x-s-label:contains("Total followers")').parent().find('.g-x-s-value span:not(.g-x-s-value-addon)');
        const followersText = followersElement.text().trim();
        const cleanedText = followersText
            .replace(/,/g, '')
            .replace(/#/g, '');
        if (!/^\d+$/.test(cleanedText)) {
            throw new Error(`Invalid format: ${followersText}`);
        }
        const followers = parseInt(cleanedText, 10);
        return followers >= 1000 ? `${(followers / 1000).toFixed(0)}k` : followers.toString();
    } catch (error) {
        console.error('TwitchTracker request failed:', error.message);
        return '756k';
    }
}

async function getBilibiliFollowers() {
    try {
        const response = await axios.get('https://api.bilibili.com/x/relation/stat', {
            params: { vmid: '3546729368520811' },
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const followers = response.data.data.follower;
        return followers >= 1000 ? `${(followers / 1000).toFixed(0)}k` : followers.toString();
    } catch (error) {
        console.error('Bilibili request failed:', error.message);
        return 'N/A';
    }
}

// ##############################
//        Schedule Parsing
// ##############################
/**
 * 解析Discord消息文本，提取并清理时间表内容。
 * @param {string} messageText 原始的Discord消息文本。
 * @returns {Array<Object>} 包含 { time: number (Unix timestamp in seconds), content: string } 的时间表数组。
 */
function parseScheduleMessage(messageText) {
    const schedule = [];
    if (!messageText) {
        return schedule;
    }

    const lines = messageText.split('\n');

    // 正则表达式用于匹配和清理各种Discord格式
    const timestampRegex = /<t:(\d+):[FDRT]?>/g; // 匹配 Discord 时间戳: <t:unix_timestamp:format>
    const customEmojiRegex = /<(a)?:[^:]+:\d+>/g; // 匹配 Discord 自定义表情: <:name:id> 或 <a:name:id>
    const unicodeEmojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g; // 匹配 Unicode 表情符号
    const mentionRegex = /<@!?\d+>|<@&\d+>/g; // 匹配用户或角色提及: <@id> 或 <@&id>
    const discordLinkRegex = /\[.*?\]\(<https:\/\/discord.com\/channels\/.*?>\)/g; // 匹配 Discord 频道/消息链接
    const leadingDashRegex = /^\s*-\s*/; // 匹配开头可能的 `-` 或 ` - `

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // 检查行是否以 Discord 时间戳开头，这是识别时间表项的关键
        const firstTimestampMatch = trimmedLine.match(timestampRegex);
        if (firstTimestampMatch && firstTimestampMatch.length > 0) {
            // 提取 Unix 时间戳（秒）
            const unixTimestamp = parseInt(firstTimestampMatch[0].match(/<t:(\d+):/)[1], 10);

            let content = trimmedLine;

            // 1. 移除所有 Discord 时间戳
            content = content.replace(timestampRegex, '');

            // 2. 移除 Discord 自定义表情
            content = content.replace(customEmojiRegex, '');

            // 3. 移除 Unicode 表情符号
            content = content.replace(unicodeEmojiRegex, '');

            // 4. 移除用户或角色提及
            content = content.replace(mentionRegex, '');

            // 5. 移除 Discord 特定链接 (如 #art post)
            content = content.replace(discordLinkRegex, '');

            // 6. 清理可能剩下的 ' - ' 分隔符和多余空格
            // 示例: " - - Experimental Neuro Stream" -> "Experimental Neuro Stream"
            content = content.replace(/^\s*-\s*-\s*/, '')
                             // 示例: "- Offline" -> "Offline"
                             .replace(leadingDashRegex, '')
                             .trim();

            // 如果清理后内容为空，则跳过
            if (content) {
                schedule.push({
                    time: unixTimestamp, // 直接存储 Unix 时间戳
                    content: content
                });
            }
        }
    }
    console.log('Parsed Schedule:', schedule);
    return schedule;
}


// ##############################
//        Json generate
// ##############################
/**
 * 生成包含更新时间、粉丝数、图片URL和时间表数据的JSON文件。
 * @param {string} twitchFollowers Twitch粉丝数
 * @param {string} biliFollowers Bilibili粉丝数
 * @param {Array<Object>} scheduleData 解析后的时间表数据
 */
async function generateDataFile(twitchFollowers, biliFollowers, scheduleData) {
    try {
        const now = moment()
            .tz('Asia/Shanghai')
            .format(CONFIG.TIME_FORMAT);
        const data = {
            lastUpdated: now,
            twitchFollowers,
            bilibiliFollowers: biliFollowers,
            imageUrl: 'images/schedule.webp',
            schedule: scheduleData // 新增字段：时间表数据
        };
        if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
            fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
        }
        fs.writeFileSync(CONFIG.DATA_PATH, JSON.stringify(data, null, 2));
        console.log('📊 JSON generated:', data);
    } catch (error) {
        console.error('JSON generation failed:', error.message);
    }
}

// ##############################
//        Main process
// ##############################
async function main() {
    try {
        await client.login(CONFIG.TOKEN);

        const twitchFollowers = await getTwitchFollowers();
        const biliFollowers = await getBilibiliFollowers();
        console.log('Get followers:', `Twitch: ${twitchFollowers}`);
        console.log('Get followers:', `Bilibili: ${biliFollowers}`);

        const { imageUrl, messageContent } = await findLatestImage();

        // 解析消息内容，获取时间表数据
        const scheduleData = parseScheduleMessage(messageContent);

        await Promise.all([
            // 将解析后的时间表数据传递给 generateDataFile
            generateDataFile(twitchFollowers, biliFollowers, scheduleData),
            downloadFile(imageUrl)
        ]);

    } catch (error) {
        console.error('Main process failed:', error.message);
        process.exit(1);
    } finally {
        client.destroy();
        console.log('🔌 Discord client logout.');
    }
}

// 启动程序
main().catch(err => {
    console.error('ERROR:', err);
    process.exit(1);
});
