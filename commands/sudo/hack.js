// commands/sudo/hack.js
// Export a factory that returns the hack handler:
// module.exports = (client, { HACK_DELAY_MS, sleep, findMemberByString, isProtected }) => async function hackHandler(message, arg) { ... }

module.exports = (client, {
  HACK_DELAY_MS = 120,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
  findMemberByString,
  isProtected = () => false
} = {}) => {
  if (!findMemberByString) {
    throw new Error('findMemberByString helper must be provided to hack module');
  }

  // Helpers to generate fake values
  function fakeIP() {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 254) + 1).join('.');
  }
  function fakeBank() {
    const banks = ['Unity Bank', 'First Quantum', 'NexTrust', 'Nova Credit', 'Stellar Savings'];
    return {
      bank: banks[Math.floor(Math.random() * banks.length)],
      balance: `$${(Math.floor(Math.random() * 9000) + 100).toLocaleString()}.${String(Math.floor(Math.random()*100)).padStart(2,'0')}`,
      last4: String(Math.floor(Math.random() * 9000) + 1000)
    };
  }
  function fakeAccountNumber() {
    return '****' + ('' + (Math.floor(Math.random()*9000)+1000));
  }
  function fakeEmail(username) {
    const domains = ['example.com', 'mailinator.com', 'fastmail.com', 'mail.gg', 'inbox.com'];
    const name = (username || 'user').toLowerCase().replace(/[^\w]/g,'').slice(0,10) || 'user';
    return `${name}${Math.floor(Math.random()*90)+10}@${domains[Math.floor(Math.random()*domains.length)]}`;
  }
  function fakePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';
    let s = '';
    for (let i=0;i<10;i++) s += chars[Math.floor(Math.random()*chars.length)];
    return s;
  }
  function random(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Resolve a target string to a GuildMember (robust)
  async function resolveMember(message, targetStr) {
    if (!message || !message.guild || !targetStr) return null;
    const guild = message.guild;

    // 1) explicit mention (prefer message mentions because they may be present)
    const mentioned = message.mentions?.members?.first();
    if (mentioned) return mentioned;

    // 2) id-like (<@id> or raw id)
    const idMatch = targetStr.match(/^<@!?(\d+)>$|^(\d{6,21})$/);
    if (idMatch) {
      const id = idMatch[1] || idMatch[2];
      try {
        const fetched = await guild.members.fetch(id).catch(() => null);
        if (fetched) return fetched;
      } catch (_) {}
    }

    // 3) exact username#discriminator
    const tagMatch = targetStr.match(/^(.{1,32})#(\d{4})$/);
    if (tagMatch) {
      const uname = tagMatch[1];
      const disc = tagMatch[2];
      try {
        // try cache first
        const byTag = guild.members.cache.find(m => (m.user?.username === uname && m.user?.discriminator === disc));
        if (byTag) return byTag;
        // fallback to fetch by query (may return partial list)
        const fetchedList = await guild.members.fetch({ query: uname, limit: 10 }).catch(()=>null);
        if (fetchedList && fetchedList.size) {
          const exact = fetchedList.find(m => (m.user?.username === uname && m.user?.discriminator === disc));
          if (exact) return exact;
        }
      } catch (_) {}
    }

    // 4) use the provided helper (may perform both cache and remote fetch)
    try {
      const found = await findMemberByString(message, targetStr).catch ? await findMemberByString(message, targetStr) : await Promise.resolve(findMemberByString(message, targetStr));
      if (found) {
        // found might be a User or a GuildMember - normalize to GuildMember
        if (found.user && found.id) return found; // already GuildMember
        if (found.id) {
          try {
            const gm = await guild.members.fetch(found.id).catch(() => null);
            if (gm) return gm;
          } catch (_) {}
        }
      }
    } catch (_) {}

    // 5) last-resort partial/case-insensitive cache match
    try {
      const lower = targetStr.toLowerCase();
      const inCache = guild.members.cache.find(m =>
        (m.user.username && m.user.username.toLowerCase() === lower) ||
        (m.displayName && m.displayName.toLowerCase() === lower) ||
        (m.user.username && m.user.username.toLowerCase().includes(lower)) ||
        (m.displayName && m.displayName.toLowerCase().includes(lower))
      );
      if (inCache) return inCache;
    } catch (_) {}

    return null;
  }

  // Main handler returned by factory
  return async function hackHandler(message, arg) {
    try {
      if (!arg) return 'Usage: sudo hack <username|nickname|mention|id> [type]';
      if (!message.guild) return 'This command only works in a server';

      // parse optional type (last token if known)
      const tokens = arg.split(' ').filter(Boolean);
      const possibleType = tokens[tokens.length - 1]?.toLowerCase();
      const knownTypes = new Set(['ip', 'bank', 'account', 'email', 'full', 'profile', 'password']);
      let type = 'profile';
      if (possibleType && knownTypes.has(possibleType)) {
        type = possibleType;
        tokens.pop();
      }
      const targetStr = tokens.join(' ').trim();
      if (!targetStr) return 'Usage: sudo hack <username|nickname|mention|id> [type]';

      // Resolve to GuildMember
      const resolved = await resolveMember(message, targetStr);
      if (!resolved) return `Cannot hack unknown target: ${targetStr}`;

      // Ensure we have a fresh GuildMember instance (fetch if needed)
      let targetMember = resolved;
      try {
        // If resolved is not a true GuildMember (safety), attempt fetch
        if (!targetMember.user || !targetMember.id || !targetMember.joinedAt) {
          const fetched = await message.guild.members.fetch(targetMember.id).catch(() => null);
          if (fetched) targetMember = fetched;
        }
      } catch (_) { /* ignore */ }

      if (!targetMember || !targetMember.id) {
        return `Cannot resolve target as server member: ${targetStr}`;
      }

      // Prevent hacking yourself
      if (targetMember.id === message.author.id) {
        return `You cannot hack yourself. Nice try.`;
      }

      // firewall protection (support async or sync isProtected)
      try {
        let prot = false;
        try {
          const maybe = isProtected(message.guild.id, targetMember.id);
          prot = (maybe && typeof maybe.then === 'function') ? await maybe : Boolean(maybe);
        } catch (e) {
          prot = false;
        }
        if (prot) {
          return {
            hack: true,
            progress: [
              'Targeting user .', 'Targeting user ..', 'Targeting user ...',
              'Checking firewall .', 'Checking firewall ..', 'Checking firewall ...'
            ],
            result: null,
            error: `Firewall active: ${targetMember.user.username} is protected in this server. Hacking blocked.`
          };
        }
      } catch (e) {
        // continue if protection check fails unexpectedly
      }

      // Role hierarchy check
      try {
        const requester = await message.guild.members.fetch(message.author.id).catch(()=>null);
        if (requester && targetMember.roles && requester.roles && targetMember.roles.highest && requester.roles.highest) {
          if (targetMember.roles.highest.position >= requester.roles.highest.position && message.guild.ownerId !== requester.id) {
            return {
              hack: true,
              progress: [
                'Targeting user .', 'Targeting user ..', 'Targeting user ...',
                'Examining privileges .', 'Examining privileges ..', 'Examining privileges ...'
              ],
              result: null,
              error: `Permission error: ${targetMember.user.username} is higher or equal in role hierarchy. Action denied.`
            };
          }
        }
      } catch (e) {
        // ignore and proceed
      }

      // Can the bot manage this member (change nickname)?
      const canManage = !!targetMember.manageable;

      // Build progress stages
      const stages = [
        'Targeting user',
        'Bypassing firewall',
        'Fingerprinting host',
        'Extracting credentials',
        'Finalizing exploit',
        'Hacking',
        'Loading details'
      ];
      const progress = [];
      for (const s of stages) {
        for (let d = 1; d <= 3; d++) progress.push(`${s} ${'.'.repeat(d)}`);
      }

      // Safe base name for nickname animation
      const rawDisplay = (typeof targetMember.displayName === 'string' && targetMember.displayName) || (targetMember.user && targetMember.user.username) || 'User';
      const cleaned = rawDisplay.replace(/^(Hacking|Hacked)\b[\s-]*/i, '').trim();
      const baseName = (cleaned.split(' ')[0] || (targetMember.user && targetMember.user.username) || 'User');

      // Kick off nickname animation in background (best-effort)
      if (canManage) {
        (async () => {
          try {
            // use local reference to avoid re-fetching every loop (best-effort)
            for (let i = 0; i < progress.length; i++) {
              const dots = '.'.repeat((i % 3) + 1);
              const nick = `Hacking ${baseName} ${dots}`;
              try {
                await targetMember.setNickname(nick).catch(() => {});
              } catch (_) {}
              await sleep(HACK_DELAY_MS);
            }
            try {
              await targetMember.setNickname('Hacked').catch(() => {});
            } catch (_) {}
          } catch (_) {
            // ignore animation errors
          }
        })();
      }

      // Notify target by DM (best-effort)
      (async () => {
        try {
          const dmText = `⚠️ Notice: You have been targeted by a playful 'hack' simulation executed by ${message.author.tag} in server "${message.guild?.name || 'unknown'}". This is a simulated / fun action performed by a bot. Type: ${type.toUpperCase()}. If this was unwanted, contact the server admins.`;
          await targetMember.send(dmText).catch(() => {});
        } catch (_) {}
      })();

      // Collect public info
      const user = targetMember.user;
      let fetchedUser = user;
      try {
        fetchedUser = await client.users.fetch(user.id, { force: false }).catch(() => user);
      } catch (_) {
        fetchedUser = user;
      }

      const presence = targetMember.presence || {};
      const activities = (presence.activities && presence.activities.length) ? presence.activities : [];
      const firstActivity = activities[0];
      const activityLabel = firstActivity ? `${firstActivity.type ? firstActivity.type : ''} ${firstActivity.name || firstActivity.details || ''}`.trim() : 'None';

      let about = 'Not available';
      try {
        if (typeof fetchedUser?.bio === 'string' && fetchedUser.bio.trim()) about = fetchedUser.bio.trim();
        else if (typeof fetchedUser?.about === 'string' && fetchedUser.about.trim()) about = fetchedUser.about.trim();
        else if (fetchedUser?.banner) about = 'Has a banner (not shown)';
        else about = 'Not available';
      } catch (_) {
        about = 'Not available';
      }

      const createdAt = fetchedUser.createdAt ? fetchedUser.createdAt.toISOString() : 'unknown';
      const joinedAt = targetMember.joinedAt ? targetMember.joinedAt.toISOString() : 'unknown';

      let mutualCount = 0;
      try {
        mutualCount = client.guilds.cache.reduce((acc, g) => {
          try {
            return acc + (g.members.cache && g.members.cache.has(targetMember.id) ? 1 : 0);
          } catch (_) { return acc; }
        }, 0);
      } catch (e) {
        mutualCount = 0;
      }

      // Base fields
      const baseFields = [
        { name: 'Name', value: targetMember.displayName || fetchedUser.username, inline: true },
        { name: 'Tag', value: `${fetchedUser.username}#${fetchedUser.discriminator}`, inline: true },
        { name: 'ID', value: `${targetMember.id}`, inline: true },
        { name: 'Account created', value: createdAt, inline: false },
        { name: 'Server joined', value: joinedAt, inline: false },
        { name: 'About', value: about, inline: false },
        { name: 'Status', value: (presence.status || 'offline'), inline: true },
        { name: 'Activity', value: activityLabel, inline: true }
      ];

      // Type-specific fake outputs
      let extraFields = [];
      switch (type) {
        case 'ip': {
          extraFields.push({ name: 'Last known IP', value: fakeIP(), inline: true });
          extraFields.push({ name: 'ISP', value: random(['ComNet', 'FastWave', 'Hyperlink ISP','LocalNet']), inline: true });
          extraFields.push({ name: 'Last login (simulated)', value: new Date(Date.now() - Math.floor(Math.random()*1000*60*60*24*30)).toISOString(), inline: false });
          break;
        }
        case 'bank': {
          const b = fakeBank();
          extraFields.push({ name: 'Bank', value: b.bank, inline: true });
          extraFields.push({ name: 'Balance (simulated)', value: b.balance, inline: true });
          extraFields.push({ name: 'Account (masked)', value: fakeAccountNumber(), inline: false });
          extraFields.push({ name: 'Last transaction (sim)', value: `$${Math.floor(Math.random()*200)} at ${random(['Coffee Shop','Online Store','ATM'])}`, inline: false });
          break;
        }
        case 'account': {
          extraFields.push({ name: 'Primary email', value: fakeEmail(fetchedUser.username), inline: true });
          extraFields.push({ name: 'Linked services', value: random(['Steam, Discord','Google, Discord','Discord, Reddit','Spotify']), inline: true });
          extraFields.push({ name: 'Account tier', value: random(['Free','Premium','Pro']), inline: false });
          break;
        }
        case 'email': {
          extraFields.push({ name: 'Email (simulated)', value: fakeEmail(fetchedUser.username), inline: false });
          extraFields.push({ name: 'Email verified', value: random(['Yes','No']), inline: true });
          extraFields.push({ name: 'Inbox messages (sim)', value: String(Math.floor(Math.random()*300)), inline: true });
          break;
        }
        case 'password': {
          extraFields.push({ name: 'Likely password (simulated)', value: fakePassword(), inline: false });
          extraFields.push({ name: 'Password strength', value: random(['Weak','Medium','Strong']), inline: true });
          break;
        }
        case 'full':
        case 'profile':
        default: {
          extraFields.push({ name: 'Last known IP', value: fakeIP(), inline: true });
          const b = fakeBank();
          extraFields.push({ name: 'Bank balance (sim)', value: b.balance, inline: true });
          extraFields.push({ name: 'Primary email', value: fakeEmail(fetchedUser.username), inline: false });
          break;
        }
      }

      const typedFields = baseFields.concat(extraFields);
      const avatar = fetchedUser.displayAvatarURL ? fetchedUser.displayAvatarURL({ size: 512 }) : (user.displayAvatarURL ? user.displayAvatarURL({ size: 512 }) : null);

      return {
        hack: true,
        progress,
        result: {
          avatar,
          typedFields,
          renamed: canManage,
          mutualServersCached: mutualCount,
          _targetMemberId: targetMember.id,
          _guildId: message.guild.id,
          _type: type
        }
      };
    } catch (err) {
      console.error('hackHandler internal error:', err);
      return {
        hack: true,
        progress: ['Targeting user ..', 'Analyzing ..', 'Finalizing ..'],
        result: null,
        error: 'Internal error while performing hack simulation. See bot logs.'
      };
    }
  };
};
