const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const moment = require('moment-timezone');
const cheerio = require('cheerio');
require('dotenv').config();

// ##############################
//         配置区块
// ##############################
const CONFIG = {
    TIME_FORMAT: 'MMM D HH:mm [GMT]+8',
    CHANNEL_ID: process.env.CHANNEL_ID,
    TOKEN: process.env.DISCORD_TOKEN,
    IMAGE_PATH: path.resolve(__dirname, '../images/schedule.png'),
    DATA_PATH: path.resolve(__dirname, '../public/data.json'),
    OUTPUT_DIR: path.resolve(__dirname, 'public')
};

moment.locale('en-us');

// ##############################
//        Discord 客户端模块
// ##############################
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`🏃 机器人 ${client.user.tag} 已就绪`);
});

async function findLatestImage() {
    try {
        const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
        const messages = await channel.messages.fetch({ limit: 10 });

        for (const message of messages.values()) {
            if (message.attachments.size > 0) {
                const image = message.attachments.find(att => 
                    att.contentType?.startsWith('image/') || 
                    ['.png', '.jpg', '.webp'].some(ext => att.url.endsWith(ext))
                );
                if (image) return image.url;
            }
        }
        throw new Error('最近10条消息中未找到图片');

    } catch (error) {
        console.error('消息扫描失败:', error.message);
        process.exit(1);
    }
}

// ##############################
//        文件操作模块
// ##############################
async function downloadFile(url) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream'
        });

        if (!fs.existsSync(path.dirname(CONFIG.IMAGE_PATH))) {
            fs.mkdirSync(path.dirname(CONFIG.IMAGE_PATH), { recursive: true });
        }

        const writer = fs.createWriteStream(CONFIG.IMAGE_PATH);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log('✅ 图片已更新');
                resolve(true);
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('下载失败:', error.message);
        return false;
    }
}

// ##############################
//        数据获取模块
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
        const followersText = $('div.g-t:contains("Total followers")').next().text().trim();
        const cleanedText = followersText
            .replace(/,/g, '') // 去除千分位逗号
            .replace(/#/g, ''); // 去除可能存在的特殊字符
            
        if (!/^\d+$/.test(cleanedText)) {
            throw new Error(`无效的粉丝数格式: ${followersText}`);
        }
        
        const followers = parseInt(cleanedText, 10);
        return followers >= 1000 ? `${(followers / 1000).toFixed(0)}k` : followers.toString();
    } catch (error) {
        console.error('TwitchTracker请求失败:', error.message);
        return '752k';
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
        console.error('获取B站粉丝数失败:', error.message);
        return 'N/A';
    }
}

// ##############################
//        JSON 数据生成模块
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
            imageUrl: 'images/schedule.png' // 相对路径
        };

        if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
            fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
        }

        fs.writeFileSync(CONFIG.DATA_PATH, JSON.stringify(data, null, 2));
        console.log('📊 数据文件已生成:', data);
    } catch (error) {
        console.error('生成数据文件失败:', error.message);
    }
}

// ##############################
//        主程序逻辑
// ##############################
async function main() {
    try {
        await client.login(CONFIG.TOKEN);

        const twitchFollowers = await getTwitchFollowers();
        const biliFollowers = await getBilibiliFollowers();
        console.log('获取粉丝数:', `T台: ${twitchFollowers}`);
        console.log('获取粉丝数:', `B站: ${biliFollowers}`);
        
        await Promise.all([
            generateDataFile(twitchFollowers, biliFollowers),
            (async () => {
                const imageUrl = await findLatestImage();
                await downloadFile(imageUrl);
            })()
        ]);
    } catch (error) {
        console.error('主程序运行失败:', error.message);
        process.exit(1);
    } finally {
        client.destroy();
        console.log('🔌 Discord 客户端已断开');
    }
}

// 启动程序
main().catch(err => {
    console.error('程序异常终止:', err);
    process.exit(1);
});