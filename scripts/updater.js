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
    CLASH_CONFIG_ENDPOINT: 'http://127.0.0.1:8963',
    CHANNEL_ID: process.env.channel_id,
    TOKEN: process.env.token,
    IMAGE_PATH: path.resolve(__dirname, '../images/schedule.png'),
    HTML_PATH: path.resolve(__dirname, '../index.html')
};

moment.locale('en-us');

// ##############################
//         Mihomo 服务模块
// ##############################
let needRestore = false;
const clashClient = axios.create({
    baseURL: CONFIG.CLASH_CONFIG_ENDPOINT,
    headers: process.env.CLASH_SECRET ? {
        'Authorization': `Bearer ${process.env.CLASH_SECRET}`
    } : {}
});

async function getTunStatus() {
    try {
        const response = await clashClient.get('/configs');
        return response.data.tun?.enable || false;
    } catch (error) {
        console.error('获取 Clash 配置失败:', error.message);
        process.exit(1);
    }
}

async function setTunMode(enable) {
    try {
        await clashClient.patch('/configs', { tun: { enable } });
        console.log(`✅ TUN 模式已 ${enable ? '启用' : '禁用'}`);
    } catch (error) {
        console.error('切换 TUN 模式失败:', error.message);
        process.exit(1);
    }
}

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
//        HTML 处理模块
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
        const statsSection = $('div.g-t:contains("Total followers")').first();
        const cleanedText = '752,601'
            .replace(/,/g, '') // 去除千分位逗号
            .replace(/#/g, ''); // 去除可能存在的特殊字符
        if (!/^\d+$/.test(cleanedText)) {
            throw new Error(`无效的粉丝数格式: ${followersText}`);
        }
        const followers = parseInt(cleanedText, 10);
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

function updateTimestamp() {
    try {
        const now = moment()
            .tz('Asia/Shanghai')
            .format(CONFIG.TIME_FORMAT);

        const htmlContent = fs.readFileSync(CONFIG.HTML_PATH, 'utf8')
            .replace(
                /(<a\s+[^>]*?id="update-time"[^>]*?>[\s\S]*?Update@)[^<]*(<\/a>)/,
                `$1${now}$2`
            );

        fs.writeFileSync(CONFIG.HTML_PATH, htmlContent);
        console.log('🕒 链接时间戳更新成功');
    } catch (error) {
        console.error('时间戳更新失败:', error.message);
    }
}

async function updateHtmlFile(twitchFollowers, biliFollowers) {
    try {
        const html = fs.readFileSync(CONFIG.HTML_PATH, 'utf8');
        const $ = cheerio.load(html);

        $('#twitch-follower').text(`${twitchFollowers} followers`);
        $('#bili-follower').text(`${biliFollowers} followers`);

        await fs.promises.writeFile(CONFIG.HTML_PATH, $.html(), 'utf8');
        
        console.log('📄 HTML 文件更新完成，Twitch: %s, Bilibili: %s', 
            twitchFollowers, 
            biliFollowers
        );
    } catch (error) {
        console.error('HTML 文件更新失败:', error.message);
    }
}

// ##############################
//        主程序逻辑
// ##############################
async function main() {
    const isTunEnabled = await getTunStatus();
    console.log(`ℹ️ 当前 TUN 状态: ${isTunEnabled ? '已启用' : '已禁用'}`);

    if (!isTunEnabled) {
        await setTunMode(true);
        needRestore = true;
    }

    try {
        await client.login(CONFIG.TOKEN);

        const twitchFollowers = await getTwitchFollowers();
        const biliFollowers = await getBilibiliFollowers();
        console.log('获取粉丝数:', `T台: ${twitchFollowers}`);
        console.log('获取粉丝数:', `B站: ${biliFollowers}`);
        
        await Promise.all([
            updateHtmlFile(twitchFollowers, biliFollowers),
            (async () => {
                const imageUrl = await findLatestImage();
                if (await downloadFile(imageUrl)) {
                    updateTimestamp();
                }
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

// ##############################
//        退出清理逻辑
// ##############################
async function cleanup() {
    if (needRestore) {
        console.log('\n🔄 恢复 TUN 状态...');
        await setTunMode(false);
    }
}

['SIGINT', 'SIGTERM', 'exit'].forEach(event => {
    process.on(event, async () => {
        if (event !== 'exit') setTimeout(() => process.exit(), 100);
        await cleanup();
    });
});

// 启动程序
main().catch(err => {
    console.error('程序异常终止:', err);
    process.exit(1);
});