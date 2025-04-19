const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const moment = require('moment-timezone');
const cheerio = require('cheerio');
const sharp = require('sharp');
require('dotenv').config();

// ##############################
//         Config
// ##############################
const CONFIG = {
    TIME_FORMAT: 'MMM D HH:mm [GMT]+8',
    CHANNEL_ID: process.env.CHANNEL_ID,
    TOKEN: process.env.DISCORD_TOKEN,
    IMAGE_PATH: path.resolve(__dirname, '../images/schedule.png'),
    WEBP_PATH: path.resolve(__dirname, '../images/schedule.webp'),
    DATA_PATH: path.resolve(__dirname, '../public/data.json'),
    OUTPUT_DIR: path.resolve(__dirname, 'public')
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

async function findLatestImage() {
    try {
        const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
        const messages = await channel.messages.fetch({ limit: 10, order: 'desc' });
        console.log('Messages fetched: ', messages.size);

        for (const message of messages.values()) {
            console.log(`Checking message ${message.id} (created: ${message.createdAt})`);

            if (message.attachments.size > 0) {
                for (const [_, attachment] of message.attachments) {
                    const isImage = attachment.contentType?.startsWith('image/') || 
                                   ['.png', '.jpg', '.jpeg', '.webp', '.gif'].some(ext => 
                                       attachment.name?.toLowerCase().endsWith(ext));
                    
                    if (isImage) {
                        console.log('✅ Found image in attachments:', attachment.url);
                        return attachment.url;
                    }
                }
            }

            if (message.embeds.length > 0) {
                for (const embed of message.embeds) {
                    const imageUrl = embed.image?.url || embed.thumbnail?.url;
                    if (imageUrl) {
                        console.log('✅ Found image in embed:', imageUrl);
                        return imageUrl;
                    }
                }
            }

            if (message.content) {
                const imageUrlMatch = message.content.match(
                    /https?:\/\/[^\s]+?\.(png|jpg|jpeg|webp|gif)(\?[^\s]+)?/i
                );
                if (imageUrlMatch) {
                    console.log('✅ Found image URL in content:', imageUrlMatch[0]);
                    return imageUrlMatch[0];
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
//        Json generate
// ##############################
async function generateDataFile(twitchFollowers, biliFollowers) {
    try {
        const now = moment()
            .tz('Asia/Shanghai')
            .format(CONFIG.TIME_FORMAT);

        const data = {
            lastUpdated: now,
            twitchFollowers,
            bilibiliFollowers: biliFollowers,
            imageUrl: 'images/schedule.webp'
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
        
        await Promise.all([
            generateDataFile(twitchFollowers, biliFollowers),
            (async () => {
                const imageUrl = await findLatestImage();
                await downloadFile(imageUrl);
            })()
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
