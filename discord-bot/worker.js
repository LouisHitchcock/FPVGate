// Cloudflare Worker - FPVGate GitHub Discord Notifications
// Receives GitHub webhook events and posts formatted embeds to Discord

const REPO_URL = 'https://github.com/LouisHitchcock/FPVGate';
const AVATAR_URL = 'https://github.com/LouisHitchcock/FPVGate/raw/main/logo/logo.png';
const BOT_USERNAME = 'FPVGate GitHub';

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        const event = request.headers.get('X-GitHub-Event');
        if (!event) {
            return new Response('Missing X-GitHub-Event header', { status: 400 });
        }

        // Verify GitHub webhook signature
        const payload = await request.text();
        const signature = request.headers.get('X-Hub-Signature-256');

        if (env.GITHUB_WEBHOOK_SECRET) {
            const valid = await verifySignature(payload, signature, env.GITHUB_WEBHOOK_SECRET);
            if (!valid) {
                return new Response('Invalid signature', { status: 401 });
            }
        }

        const data = JSON.parse(payload);
        let embed = null;

        switch (event) {
            case 'push':
                embed = buildPushEmbed(data);
                break;
            case 'create':
                embed = buildCreateEmbed(data);
                break;
            case 'watch':
                embed = buildStarEmbed(data);
                break;
            case 'release':
                embed = buildReleaseEmbed(data);
                break;
            default:
                return new Response(JSON.stringify({ received: true, skipped: event }), {
                    headers: { 'Content-Type': 'application/json' }
                });
        }

        if (embed && env.DISCORD_WEBHOOK_URL) {
            await fetch(env.DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: BOT_USERNAME,
                    avatar_url: AVATAR_URL,
                    embeds: [embed]
                })
            });
        }

        return new Response(JSON.stringify({ received: true, event }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// --- Signature Verification ---

async function verifySignature(payload, signature, secret) {
    if (!signature) return false;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const expected = 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (expected.length !== signature.length) return false;
    let result = 0;
    for (let i = 0; i < expected.length; i++) {
        result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
}

// --- Embed Builders ---

function buildPushEmbed(data) {
    const branch = data.ref.replace('refs/heads/', '');
    const commits = data.commits || [];
    const count = commits.length;

    if (count === 0) return null;

    const commitLines = commits.slice(0, 10).map(c => {
        const sha = c.id.substring(0, 7);
        const msg = c.message.split('\n')[0];
        const truncated = msg.length > 72 ? msg.substring(0, 72) + '...' : msg;
        return `[\`${sha}\`](${c.url}) ${truncated}`;
    });

    if (count > 10) {
        commitLines.push(`... and ${count - 10} more`);
    }

    return {
        title: `${count} new commit${count > 1 ? 's' : ''} to \`${branch}\``,
        url: data.compare,
        color: 0x5865F2,
        description: commitLines.join('\n'),
        author: {
            name: data.pusher?.name || data.sender?.login || 'Unknown',
            icon_url: data.sender?.avatar_url || '',
            url: data.sender?.html_url || ''
        },
        footer: { text: `${data.repository?.full_name || 'FPVGate'}` },
        timestamp: new Date().toISOString()
    };
}

function buildCreateEmbed(data) {
    if (data.ref_type !== 'branch') return null;

    return {
        title: `New branch created: \`${data.ref}\``,
        url: `${REPO_URL}/tree/${data.ref}`,
        color: 0x57F287,
        author: {
            name: data.sender?.login || 'Unknown',
            icon_url: data.sender?.avatar_url || '',
            url: data.sender?.html_url || ''
        },
        footer: { text: `${data.repository?.full_name || 'FPVGate'}` },
        timestamp: new Date().toISOString()
    };
}

function buildStarEmbed(data) {
    if (data.action !== 'started') return null;

    const count = data.repository?.stargazers_count || 0;

    return {
        title: `New star! Now at ${count} star${count !== 1 ? 's' : ''}`,
        url: `${REPO_URL}/stargazers`,
        color: 0xFEE75C,
        author: {
            name: data.sender?.login || 'Someone',
            icon_url: data.sender?.avatar_url || '',
            url: data.sender?.html_url || ''
        },
        footer: { text: `${data.repository?.full_name || 'FPVGate'}` },
        timestamp: new Date().toISOString()
    };
}

function buildReleaseEmbed(data) {
    if (data.action !== 'published') return null;

    const release = data.release;
    const body = release.body || '';
    const truncated = body.length > 1000 ? body.substring(0, 1000) + '...' : body;

    const fields = [
        { name: 'Tag', value: `\`${release.tag_name}\``, inline: true }
    ];

    if (release.prerelease) {
        fields.push({ name: 'Pre-release', value: 'Yes', inline: true });
    }

    const assets = release.assets || [];
    if (assets.length > 0) {
        const assetList = assets.slice(0, 5).map(a => `[${a.name}](${a.browser_download_url})`).join('\n');
        fields.push({ name: 'Downloads', value: assetList, inline: false });
    }

    return {
        title: `New Release: ${release.name || release.tag_name}`,
        url: release.html_url,
        color: 0xEB459E,
        description: truncated,
        fields,
        author: {
            name: release.author?.login || data.sender?.login || 'Unknown',
            icon_url: release.author?.avatar_url || data.sender?.avatar_url || '',
            url: release.author?.html_url || data.sender?.html_url || ''
        },
        footer: { text: `${data.repository?.full_name || 'FPVGate'}` },
        timestamp: release.published_at || new Date().toISOString()
    };
}
