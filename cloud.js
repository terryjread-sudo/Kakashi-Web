'use strict';
(() => {
 const config=window.KAISHI_SUPABASE_CONFIG,sdk=window.supabase;
 const account=$('#cloudAccount'),status=$('#cloudStatus'),join=$('#leaderboardOptIn');
 const leaderboard=$('#leaderboardList'),leaderboardMessage=$('#leaderboardMessage');
 const OWNER_LOGIN='terryjread-sudo',GUEST_IMAGE=`media/profiles/guest-learner.webp?v=${APP_VERSION}`;
 const AVATARS=[
  {key:'boy',name:'Boy',mastered:0},{key:'girl',name:'Girl',mastered:0},{key:'master',name:'Master',mastered:0},{key:'man',name:'Man',mastered:0},{key:'woman',name:'Woman',mastered:0},
  {key:'harajuku-girl',name:'Harajuku Girl',mastered:10},{key:'harajuku-guy',name:'Harajuku Guy',mastered:25},{key:'izakaya-cook',name:'Izakaya Cook',mastered:50}
 ];
 const FP_KEY='kq-cloud-sync-fingerprint-v1',FRIEND_NUDGE_DISMISS_KEY='kq-friend-nudge-dismiss-v1',SOCIAL_READ_KEY='kq-social-notifications-read-v1';
 const CANONICAL_ORIGIN='https://www.kaishi.uk';
 let client=null,user=null,syncTimer=null,initialisedUserId='',syncing=false,selectedAvatar='boy',friendRefreshTimer=null,communityProfiles=new Map(),adminUsersLoaded=false,lastFriendRows=[],adminUsers=[],emailRecipientId='',emailPreviewed=false;

 const adapter=()=>window.KaishiQuestCloudAdapter;
 const setStatus=(message,state='')=>{if(status){status.textContent=message;status.dataset.state=state}};
 const setLeaderboardMessage=message=>{if(leaderboardMessage)leaderboardMessage.textContent=message};
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const avatarDefinition=value=>AVATARS.find(avatar=>avatar.key===value);
 const avatarKey=value=>avatarDefinition(value)?.key||'boy';
 const avatarState=(streak=0)=>{streak=Number(streak)||0;return streak>=60?'superhero':streak>=30?'double-flex':streak>=14?'flex':streak>=7?'double-thumbs':streak>=3?'thumbs-up':'base'};
 const avatarImage=(key=selectedAvatar,streak=0)=>`media/profiles/${avatarKey(key)}-${avatarState(streak)}.webp?v=${APP_VERSION}`;
 const avatarUnlocked=(key,stats=adapter()?.stats?.()||{})=>Boolean(adapter()?.isTestMode?.()||Number(stats.mastered||0)>=Number(avatarDefinition(key)?.mastered||0));
 const nextAvatarUnlock=(stats=adapter()?.stats?.()||{})=>AVATARS.find(avatar=>avatar.mastered&&!avatarUnlocked(avatar.key,stats));

 function profile(){const m=user?.user_metadata||{},login=m.user_name||m.preferred_username||m.login||user?.email?.split('@')[0]||'learner';return{github_login:String(login),display_name:String(m.full_name||m.name||login),avatar_url:m.avatar_url||null}}
 function isOwner(){return Boolean(user&&profile().github_login.toLowerCase()===OWNER_LOGIN)}
 function setupMissing(error){return['42P01','42703'].includes(error?.code)||/(relation|column) .* does not exist/i.test(error?.message||'')}
 function describeError(error){return setupMissing(error)?'Cloud setup is incomplete. Run the supplied Supabase SQL migrations in order.':(error?.message||'Cloud service is unavailable.')}

 function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(
   Object.keys(value).sort()
    .filter(key=>!['updatedAt','updated_at','dailyJourneyRoute','dailyActivity'].includes(key))
    .map(key=>[key,stable(value[key])])
  );
  return value;
 }
 function hash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16)}
 function fingerprint(snapshot){return hash(JSON.stringify(stable({version:snapshot?.version||2,progress:snapshot?.progress||{},meta:snapshot?.meta||{},settings:snapshot?.settings||{}})))}
 function remember(snapshot){localStorage.setItem(FP_KEY,fingerprint(snapshot))}
 function remembered(){return localStorage.getItem(FP_KEY)||''}

 function renderAvatarPicker(){const picker=$('#avatarPicker');if(!picker)return;const stats=adapter()?.stats?.()||{};picker.disabled=false;picker.querySelector('p').textContent=user?'Master words to unlock new characters. Every character gains new poses at 3, 7, 14, 30 and 60 rhythm days.':'Your guest learner is ready now. Sign in to choose characters; progression characters remain visible as future goals.';picker.querySelectorAll('[data-avatar]').forEach(button=>{const definition=avatarDefinition(button.dataset.avatar),unlocked=avatarUnlocked(button.dataset.avatar,stats),chosen=Boolean(user)&&button.dataset.avatar===selectedAvatar;button.classList.toggle('selected',chosen);button.classList.toggle('locked',!unlocked);button.setAttribute('aria-pressed',String(chosen));button.setAttribute('aria-disabled',String(!user||!unlocked));const status=button.querySelector('[data-avatar-status]');if(status)status.textContent=unlocked?(user?'Available':'Sign in to choose'):`Master ${definition?.mastered||0} words`;button.setAttribute('aria-label',`${definition?.name||'Character'}. ${unlocked?'Unlocked':`Unlocks at ${definition?.mastered||0} mastered words`}${chosen?'. Selected':''}`)})}
 function renderDashboardAvatar(){
 const streak=Number(adapter()?.stats?.().streak||0);
 const stats=adapter()?.stats?.()||{},src=user?avatarImage(selectedAvatar,streak):GUEST_IMAGE;
 const image=$('#dashboardAvatar');if(image)image.src=src;
 if($('#journeyHomeAvatar'))$('#journeyHomeAvatar').src=src;
 if($('#journeyAvatar'))$('#journeyAvatar').src=src;
 if($('#dashboardAvatarTitle'))$('#dashboardAvatarTitle').textContent=user?`@${profile().github_login}`:'Save your progress across devices';
 if($('#dashboardAvatarMilestone'))$('#dashboardAvatarMilestone').textContent=user
  ?(()=>{const nextCharacter=nextAvatarUnlock(stats),nextPose=[3,7,14,30,60].find(days=>days>streak);if(nextCharacter)return`Next character: ${nextCharacter.name} at ${nextCharacter.mastered} mastered words${nextPose?` · Next pose at ${nextPose} rhythm days`:''}.`;return nextPose?`All characters unlocked · Next pose at ${nextPose} rhythm days.`:'Every character and superhero pose unlocked!'})()
  :'Sign in with GitHub to choose a character, protect your progress and continue on another device.';
 const heroSignIn=$('#dashboardSignIn');if(heroSignIn){heroSignIn.hidden=Boolean(user);heroSignIn.onclick=signIn}
}
 function renderStudioAccess(){const owner=isOwner(),link=$('#mnemonicStudioLink');if(link)link.hidden=!owner;window.KaishiQuestPath?.renderOwnerPathControls?.(owner)}

 function renderSignedOut(message='Sign in with GitHub to sync progress between devices.'){
  user=null;initialisedUserId='';selectedAvatar='boy';
  if(account)account.innerHTML=`<img class="cloud-avatar" src="${GUEST_IMAGE}" alt="Guest learner"><div><strong>Protect your Kaishi Japanese progress</strong><p>Sign in with GitHub to sync learning, choose a character and continue on another device.</p></div><button id="cloudSignIn" class="github-button">Sign in with GitHub</button>`;
  $('#cloudSignIn')?.addEventListener('click',signIn);
  if(join){join.checked=true;join.disabled=true}
  const learningEmail=$('#learningEmailOptIn');if(learningEmail){learningEmail.checked=true;learningEmail.disabled=true}
  setStatus('Guest progress is saved only on this device.');
  renderAvatarPicker();renderDashboardAvatar();renderStudioAccess();
 }
 function renderSignedIn(entry){
  const p=profile();selectedAvatar=avatarKey(entry?.avatar_key);
  if(account)account.innerHTML=`<img class="cloud-avatar" src="${avatarImage(selectedAvatar,entry?.streak)}" alt=""><div><strong>${esc(p.display_name)}</strong><p>@${esc(p.github_login)} · GitHub account connected</p></div><button id="cloudSignOut">Sign out</button>`;
  $('#cloudSignOut')?.addEventListener('click',signOut);
  if(join){join.disabled=false;join.checked=Boolean(entry?.opted_in)}
  const learningEmail=$('#learningEmailOptIn');if(learningEmail)learningEmail.disabled=false;
  renderAvatarPicker();renderDashboardAvatar();renderStudioAccess();
 }

 function enforceCanonicalOrigin(){
  if(location.protocol!=='https:'||location.hostname!=='kaishi.uk')return false;
  location.replace(`${CANONICAL_ORIGIN}${location.pathname}${location.search}${location.hash}`);
  return true;
 }
 async function signIn(){if(!client)return;setStatus('Opening GitHub sign-in…','working');const redirectTo=`${CANONICAL_ORIGIN}/`;const{error}=await client.auth.signInWithOAuth({provider:'github',options:{redirectTo}});if(error)setStatus(describeError(error),'error')}
 async function signOut(){if(!client)return;await flush();const{error}=await client.auth.signOut();if(error)setStatus(describeError(error),'error');else renderSignedOut('Signed out. Your local progress remains on this device.')}

 async function loadEmailPreferences(){
  const control=$('#learningEmailOptIn');if(!control||!user||!client)return;
  const{data,error}=await client.rpc('get_kaishi_email_preferences');
  if(!error)control.checked=data?.learning_email!==false;
 }
 async function setLearningEmailPreference(){
  const control=$('#learningEmailOptIn');if(!control||!user||!client)return;
  control.disabled=true;
  const{error}=await client.rpc('set_kaishi_learning_email_preference',{enabled:control.checked});
  if(error){control.checked=!control.checked;setStatus(describeError(error),'error')}else setStatus(control.checked?'Kaishi learning emails are enabled.':'Kaishi learning emails are disabled.','ok');
  control.disabled=false;
 }

 async function ensureLeaderboardEntry(){
  if(!user)return null;
  const p=profile(),stats=adapter()?.stats?.()||{};
  const{data:existing,error:readError}=await client.from('leaderboard_entries').select('user_id,avatar_key').eq('user_id',user.id).maybeSingle();
  if(readError)throw readError;
  selectedAvatar=avatarKey(existing?.avatar_key||selectedAvatar);
  const values={user_id:user.id,...p,...stats,avatar_key:selectedAvatar};
  const write=existing?await client.from('leaderboard_entries').update(values).eq('user_id',user.id):await client.from('leaderboard_entries').insert({...values,opted_in:true});
  if(write.error)throw write.error;
  const{data,error}=await client.from('leaderboard_entries').select('*').eq('user_id',user.id).maybeSingle();
  if(error)throw error;return data;
 }

 async function chooseProgress(){
  const dialog=$('#cloudConflictDialog');if(!dialog)return'cloud';
  return new Promise(resolve=>{dialog.showModal();const finish=choice=>{dialog.close();resolve(choice)};$('#useCloudProgress').onclick=()=>finish('cloud');$('#keepDeviceProgress').onclick=()=>finish('device')});
 }
 async function reconcile(local,remote,forceChoice=false){
  const lf=fingerprint(local),rf=fingerprint(remote),last=remembered();
  if(lf===rf)return'cloud';
  if(!forceChoice&&last){
   if(rf===last&&lf!==last)return'device';
   if(lf===last&&rf!==last)return'cloud';
  }
  const la=Number(local?.meta?.totalAnswers||0),ra=Number(remote?.meta?.totalAnswers||0);
  if(!forceChoice&&la!==ra)return la>ra?'device':'cloud';
  const lt=Number(local?.meta?.updatedAt||0),rt=Number(remote?.meta?.updatedAt||0);
  if(!forceChoice&&Math.abs(lt-rt)<10000)return lt>=rt?'device':'cloud';
  return chooseProgress();
 }

 async function initialiseAccount(forceChoice=false){
  if(adapter()?.isTestMode?.()){setStatus('Test learner is isolated. Cloud sync is paused.','ok');return}
  if(!user||syncing||resetLock)return;syncing=true;setStatus('Checking cloud progress…','working');
  try{
   const entry=await ensureLeaderboardEntry();renderSignedIn(entry);
   const{data,error}=await client.from('user_progress').select('payload,updated_at').eq('user_id',user.id).maybeSingle();
   if(error)throw error;
   const local=adapter()?.snapshot?.()||{},remote=data?.payload;
   const localStarted=Object.keys(local.progress||{}).length>0,remoteStarted=Object.keys(remote?.progress||{}).length>0;
   if(!data){await saveSnapshot(true);setStatus('Cloud backup created.','ok')}
   else if(remoteStarted&&!localStarted){adapter()?.restore?.(remote);remember(adapter()?.snapshot?.()||remote);setStatus('Progress restored from the cloud.','ok')}
   else if(remoteStarted&&localStarted){
    const choice=await reconcile(local,remote,forceChoice);
    if(choice==='cloud'){adapter()?.restore?.(remote);remember(adapter()?.snapshot?.()||remote);setStatus('Progress synced from the cloud.','ok')}
    else{await saveSnapshot(true);setStatus('This device is now the cloud version.','ok')}
   }else{await saveSnapshot(true);setStatus('Progress is synced.','ok')}
   await loadLeaderboard();
  }catch(error){console.error('Cloud initialisation failed',error);setStatus(describeError(error),'error');setLeaderboardMessage(describeError(error))}
  finally{syncing=false}
 }

 async function saveSnapshot(force=false){
  if(!user||!client||(!force&&syncing))return;
  const payload=adapter()?.snapshot?.();if(!payload)return;
  const{error}=await client.from('user_progress').upsert({user_id:user.id,schema_version:2,payload},{onConflict:'user_id'});
  if(error)throw error;
  remember(payload);await ensureLeaderboardEntry();
 }
 function scheduleSync(){if(adapter()?.isTestMode?.()||!user||!client||resetLock)return;clearTimeout(syncTimer);syncTimer=setTimeout(async()=>{try{await saveSnapshot();setStatus('Progress synced.','ok');await loadLeaderboard();await initialiseFriends();await redeemFriendInviteFromUrl()}catch(error){console.error('Cloud sync failed',error);setStatus(describeError(error),'error')}},1400)}
 async function flush(){clearTimeout(syncTimer);if(adapter()?.isTestMode?.()||resetLock)return;if(user)try{await saveSnapshot(true)}catch(error){console.error('Cloud flush failed',error)}}

 // resetLock blocks any in-flight or newly scheduled sync (and the
 // sign-in reconcile flow) for the moment between a local reset and its
 // matching cloud write landing, so a stale queued sync or a reconcile on
 // reload can never restore the pre-reset progress out from under the user.
 let resetLock=false;
 async function resetProgress(){
  clearTimeout(syncTimer);
  if(!user||!client){remember({});return{ok:true,synced:false}}
  resetLock=true;syncing=true;setStatus('Resetting cloud progress…','working');
  try{
   const payload=adapter()?.snapshot?.()||{progress:{},meta:{},settings:{}};
   const{error}=await client.from('user_progress').upsert({user_id:user.id,schema_version:2,payload},{onConflict:'user_id'});
   if(error)throw error;
   remember(payload);
   await ensureLeaderboardEntry();
   setStatus('Progress reset and synced.','ok');
   await loadLeaderboard();
   return{ok:true,synced:true};
  }catch(error){
   console.error('Cloud reset failed',error);
   setStatus(describeError(error),'error');
   return{ok:false,synced:false,error};
  }finally{
   syncing=false;resetLock=false;
  }
 }

 
 async function friendRpc(name,args={}){if(!client||!user)throw new Error('Sign in with GitHub to use friends.');const{data,error}=await client.rpc(name,args);if(error)throw error;return data}
 function friendAvatar(row){return avatarImage(row.avatar_key||'boy',Number(row.streak||0))}
 function timeAgo(value){if(!value)return'not recently';const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return'just now';if(seconds<3600)return`${Math.floor(seconds/60)}m ago`;if(seconds<86400)return`${Math.floor(seconds/3600)}h ago`;return`${Math.floor(seconds/86400)}d ago`}
 async function loadFriends(){
  const incoming=$('#incomingFriendRequests'),list=$('#friendsList'),badge=$('#friendRequestBadge');
  if(!incoming||!list)return;
  if(!user){
   window.__kaishiFriendRows=[];
   incoming.innerHTML='<p class="muted">Sign in with GitHub to use friends.</p>';
   list.innerHTML='';
   if(badge)badge.hidden=true;
   renderFriendNudge([]);
   return;
  }
  try{
   const rows=await friendRpc('get_kaishi_friends');
   window.__kaishiFriendRows=rows||[];
   const requests=(rows||[]).filter(row=>row.relationship_status==='pending_incoming');
   const friends=(rows||[]).filter(row=>row.relationship_status==='accepted');friends.forEach(row=>communityProfiles.set(row.user_id,row));
   if(badge){badge.hidden=!requests.length;badge.textContent=`${requests.length} new`}
   incoming.innerHTML=requests.length
    ?`<h4>Friend requests</h4>${requests.map(row=>`<article class="friend-row request"><img src="${friendAvatar(row)}" alt=""><div><strong>${esc(row.display_name||row.github_login)}</strong><small>@${esc(row.github_login)}</small></div><div class="friend-actions"><button data-friend-accept="${row.request_id}" class="primary">Accept</button><button data-friend-decline="${row.request_id}">Decline</button></div></article>`).join('')}`
    :'';
   list.innerHTML=`<h4>Your friends</h4>${friends.length
    ?friends.map(row=>`<article class="friend-row accepted"><button class="friend-profile-link" data-friend-profile="${row.user_id}" type="button"><img src="${friendAvatar(row)}" alt=""><span><strong>${esc(row.display_name||row.github_login)}</strong><small>@${esc(row.github_login)} · active ${timeAgo(row.last_active_at)}</small></span></button><button data-unfriend="${row.user_id}" class="friend-unfriend-small" type="button">Unfriend</button></article>`).join('')
    :'<p class="muted">No friends yet. Select a learner from the leaderboard or share an invitation link.</p>'}`;
   document.querySelectorAll('[data-friend-accept]').forEach(button=>button.onclick=async()=>{
    await friendRpc('respond_kaishi_friend_request',{request_id:button.dataset.friendAccept,accept_request:true});
    await loadFriends();await loadLeaderboard();
   });
   document.querySelectorAll('[data-friend-decline]').forEach(button=>button.onclick=async()=>{
    await friendRpc('respond_kaishi_friend_request',{request_id:button.dataset.friendDecline,accept_request:false});
    await loadFriends();await loadLeaderboard();
   });
   document.querySelectorAll('[data-friend-profile]').forEach(button=>button.onclick=()=>openCommunityProfile(button.dataset.friendProfile));
   document.querySelectorAll('[data-unfriend]').forEach(button=>button.onclick=async()=>{
    if(!confirm('Remove this friend?'))return;
    await friendRpc('remove_kaishi_friend',{friend_user_id:button.dataset.unfriend});
    await loadFriends();await loadLeaderboard();
   });
   renderFriendNudge(friends);await renderSocialNotifications(rows||[]);
  }catch(error){
   window.__kaishiFriendRows=[];
   incoming.innerHTML='';
   list.innerHTML=`<p class="muted">${esc(describeError(error))}</p>`;
   renderFriendNudge([]);
  }
 }
 function renderFriendNudge(friends){
  const card=$('#friendActivityNudge');if(!card)return;
  const recent=(friends||[]).filter(r=>r.last_active_at&&Date.now()-new Date(r.last_active_at).getTime()<86400000).sort((a,b)=>new Date(b.last_active_at)-new Date(a.last_active_at))[0];
  let dismissed={};try{dismissed=JSON.parse(localStorage.getItem(FRIEND_NUDGE_DISMISS_KEY)||'{}')}catch{}
  if(!user||!recent||(dismissed.userId===recent.user_id&&dismissed.activity===recent.last_active_at)){card.hidden=true;return}
  card.hidden=false;card.style.display='';$('#friendActivityAvatar').src=friendAvatar(recent);$('#friendActivityTitle').textContent=`${recent.display_name||recent.github_login} studied ${timeAgo(recent.last_active_at)}`;$('#friendActivityText').textContent='Keep pace with a quick mission.';
  const open=()=>openCommunityProfile(recent.user_id);$('#friendActivityOpen').onclick=open;$('#friendActivityOpen').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}};
  const dismiss=$('#friendActivityDismiss');if(dismiss){dismiss.dataset.friendUser=recent.user_id;dismiss.dataset.friendActivity=recent.last_active_at}

 }
 async function renderSocialNotifications(rows=[]){
  const button=$('#socialNotificationButton'),panel=$('#socialNotificationPanel'),list=$('#socialNotificationList');if(!button||!panel||!list)return;
  if(!user){button.hidden=true;panel.hidden=true;return}
  let read={};try{read=JSON.parse(localStorage.getItem(SOCIAL_READ_KEY)||'{}')}catch{}
  const items=rows.filter(r=>r.relationship_status==='pending_incoming').map(r=>({id:`req:${r.request_id}`,type:'request',row:r,title:`${r.display_name||r.github_login} sent a friend request`}));
  rows.filter(r=>r.relationship_status==='accepted'&&r.accepted_at).forEach(r=>{const id=`accepted:${r.request_id}:${r.accepted_at}`;if(!read[id])items.push({id,type:'accepted',row:r,title:`${r.display_name||r.github_login} accepted your request`})});

  let offlinePack=null;try{offlinePack=JSON.parse(localStorage.getItem('kq-offline-pack')||'null')}catch{}
  if(offlinePack?.version&&offlinePack.version!==APP_VERSION){
    items.push({
      id:'offline-pack-outdated',
      type:'system',
      title:'Offline features unavailable',
      body:'Your downloaded offline content is from an older version. Update it to use offline features again.',
    });
  }

  if(isOwner()){try{const{data}=await client.rpc('get_kaishi_admin_notification_counts');if(Number(data?.unreviewed_reports||0)>0)items.push({id:'admin-reports',type:'admin',title:`${data.unreviewed_reports} learning-card report${Number(data.unreviewed_reports)===1?'':'s'} need review`})}catch{}}
  button.hidden=!items.length;const notificationCount=$('#socialNotificationCount');if(notificationCount){notificationCount.textContent=String(items.length);notificationCount.hidden=!items.length;}
  list.innerHTML=items.length?items.map(i=>`<article class="social-notification-item"><strong>${esc(i.title)}</strong>${i.body?`<p class="muted">${esc(i.body)}</p>`:''}<div class="social-notification-actions">${i.type==='request'?`<button data-na="${i.row.request_id}" class="primary">Accept</button><button data-nd="${i.row.request_id}">Decline</button>`:''}${i.type==='accepted'?`<button data-np="${i.row.user_id}">View</button><button data-nx="${esc(i.id)}">Dismiss</button>`:''}${i.type==='admin'?'<button id="openAdminNotice" class="primary">Open Admin</button>':''}${i.type==='system'?'<button data-offline-update class="primary">Update offline version</button>':''}</div></article>`).join(''):'<p class="muted">No new notifications.</p>';
  document.querySelectorAll('[data-na]').forEach(b=>b.onclick=async()=>{await friendRpc('respond_kaishi_friend_request',{request_id:b.dataset.na,accept_request:true});await loadFriends();await loadLeaderboard()});
  document.querySelectorAll('[data-nd]').forEach(b=>b.onclick=async()=>{await friendRpc('respond_kaishi_friend_request',{request_id:b.dataset.nd,accept_request:false});await loadFriends();await loadLeaderboard()});
  document.querySelectorAll('[data-np]').forEach(b=>b.onclick=()=>openCommunityProfile(b.dataset.np));
  $('#openAdminNotice')?.addEventListener('click',()=>{$('#adminEntry')?.click();panel.hidden=true});
  document.querySelectorAll('[data-offline-update]').forEach(button=>button.onclick=()=>window.KaishiOffline?.update?.());
 }
 async function loadAdminUsers(){
  const list=$('#adminUsersList'),summary=$('#adminUsersSummary');if(!list||!summary||!isOwner())return;
  list.innerHTML='<p class="muted">Loading users…</p>';
  try{
   const{data,error}=await client.rpc('get_kaishi_admin_users');if(error)throw error;
   adminUsers=data||[];
   summary.innerHTML=`<span><strong>${adminUsers.length}</strong> profiles</span><span><strong>${adminUsers.filter(r=>r.contactable).length}</strong> email enabled</span><span><strong>${adminUsers.filter(r=>!r.learning_email).length}</strong> email opt-outs</span>`;
   list.innerHTML=adminUsers.map(r=>`<article class="admin-user-row"><img src="${avatarImage(r.avatar_key||'boy',r.streak||0)}" alt=""><div><strong>${esc(r.display_name||r.github_login)}</strong><small>@${esc(r.github_login)} · signed in ${r.last_sign_in_at?timeAgo(r.last_sign_in_at):'never'}</small></div><span>${r.xp||0} XP · ${r.mastered||0} mastered · ${r.friend_count||0} friends</span><b>${r.learning_email?'Email enabled':'Email opted out'}</b><button type="button" data-admin-email-user="${esc(r.user_id)}" ${r.contactable?'':'disabled'}>${r.contactable?'Send email':'No email'}</button></article>`).join('');
   list.querySelectorAll('[data-admin-email-user]').forEach(button=>button.onclick=()=>openAdminEmail(button.dataset.adminEmailUser));
   adminUsersLoaded=true;
  }catch(e){list.innerHTML=`<p class="muted">${esc(describeError(e))}</p>`}
 }

 async function invokeAdminEmail(body){
  const{data,error}=await client.functions.invoke('admin-email',{body});
  if(error)throw new Error(error.message||'Email service is unavailable.');
  if(data?.error)throw new Error(data.error);
  return data;
 }
 function setAdminEmailStatus(message,state=''){const el=$('#adminEmailStatus');if(el){el.textContent=message;el.dataset.state=state}}
 async function openAdminEmail(userId){
  const recipient=adminUsers.find(row=>row.user_id===userId),dialog=$('#adminEmailDialog');if(!recipient||!dialog)return;
  emailRecipientId=userId;emailPreviewed=false;
  $('#adminEmailRecipient').textContent=`Email @${recipient.github_login||recipient.display_name}`;
  $('#adminEmailPreviewContent').innerHTML='';$('#adminEmailSend').disabled=true;setAdminEmailStatus('Choose a template, then preview the exact email before sending.');
  $('#adminEmailHistory').innerHTML='<p class="muted">Loading recent email activity…</p>';
  dialog.showModal();
  try{const data=await invokeAdminEmail({action:'history',userId});$('#adminEmailHistory').innerHTML=(data.history||[]).length?(data.history||[]).map(item=>`<p><strong>${esc(item.template_key)}</strong> · ${esc(item.status)} · ${new Date(item.created_at).toLocaleString()}</p>`).join(''):'<p class="muted">No previous emails.</p>'}catch(error){$('#adminEmailHistory').innerHTML=`<p class="muted">${esc(error.message)}</p>`}
 }
 async function previewAdminEmail(){
  if(!emailRecipientId)return;const button=$('#adminEmailPreview');button.disabled=true;setAdminEmailStatus('Rendering email preview…','working');
  try{const data=await invokeAdminEmail({action:'preview',userId:emailRecipientId,templateKey:$('#adminEmailTemplate').value});$('#adminEmailPreviewContent').innerHTML=data.html||'';emailPreviewed=true;$('#adminEmailSend').disabled=false;setAdminEmailStatus(`Preview ready for ${data.recipient?.name||'this learner'}.`,'ok')}catch(error){emailPreviewed=false;$('#adminEmailSend').disabled=true;setAdminEmailStatus(error.message,'error')}finally{button.disabled=false}
 }
 async function sendAdminEmail(){
  if(!emailRecipientId||!emailPreviewed)return;
  if(!confirm('Send this reviewed email now?'))return;
  const button=$('#adminEmailSend');button.disabled=true;setAdminEmailStatus('Sending email…','working');
  try{const data=await invokeAdminEmail({action:'send',userId:emailRecipientId,templateKey:$('#adminEmailTemplate').value,idempotencyKey:crypto.randomUUID()});if(!data.sent)throw new Error(data.error||'Email was not sent.');emailPreviewed=false;setAdminEmailStatus('Email sent and recorded.','ok');await loadAdminUsers()}catch(error){setAdminEmailStatus(error.message,'error');button.disabled=false}
 }
 const EMAIL_PROGRAM_DETAILS={reengagement:{title:'Return-to-learning reminder',description:'Friday at 17:00 UK time · learners away for at least 7 days.'},weekly_recap:{title:'Weekly recap',description:'Sunday at 10:00 UK time · learners active this week.'},monthly_sensei_letter:{title:'Monthly Sensei letter',description:'First day of each month at 10:00 UK time.'},onboarding_nudge:{title:'Getting-started nudge',description:'Daily at 10:00 UK time · new learners who have not returned after 3 days.'}};
 async function loadEmailAutomation(){
  const status=$('#adminEmailAutomationStatus'),list=$('#adminEmailProgramList');if(!status||!list||!isOwner())return;
  try{const{data,error}=await client.rpc('get_kaishi_email_programs');if(error)throw error;const programs=data||[];list.innerHTML=programs.map(program=>{const detail=EMAIL_PROGRAM_DETAILS[program.program_key]||{title:program.program_key,description:''},last=program.last_run_at?`Last run: ${new Date(program.last_run_at).toLocaleString()} · ${program.last_sent_count||0} sent${program.last_result?` · ${program.last_result}`:''}`:'Not run yet';return `<label class="email-program-toggle"><input type="checkbox" data-email-program="${esc(program.program_key)}" ${program.enabled?'checked':''}><span><strong>${esc(detail.title)}</strong><small>${esc(detail.description)}</small><small>${esc(last)}</small></span></label>`}).join('');list.querySelectorAll('[data-email-program]').forEach(toggle=>toggle.addEventListener('change',setEmailProgram));status.textContent=`${programs.filter(program=>program.enabled).length} of ${programs.length} scheduled programs enabled. Learners can opt out in Settings.`;status.dataset.state=''}catch(error){list.innerHTML='';status.textContent=describeError(error);status.dataset.state='error'}
 }
 async function setEmailProgram(event){
  const toggle=event.currentTarget;if(!toggle||!isOwner())return;toggle.disabled=true;
  const{error}=await client.rpc('set_kaishi_email_program_enabled',{p_program_key:toggle.dataset.emailProgram,p_enabled:toggle.checked});if(error){toggle.checked=!toggle.checked;toast(describeError(error))}await loadEmailAutomation();
 }
 async function initialiseFriends(){
  await loadFriends();
  clearInterval(friendRefreshTimer);
  friendRefreshTimer=setInterval(()=>{if(document.visibilityState==='visible')loadFriends()},60000);
 }
async function loadLeaderboard(){
  if(!client||!leaderboard)return;setLeaderboardMessage('Loading leaderboard…');
  const{data,error}=await client.from('leaderboard_entries').select('user_id,github_login,display_name,avatar_key,streak,xp,mastered,accuracy,monsters_defeated').eq('opted_in',true).order('xp',{ascending:false}).order('mastered',{ascending:false}).limit(20);
  if(error){leaderboard.innerHTML='';setLeaderboardMessage(describeError(error));return}
  if(!data?.length){leaderboard.innerHTML='';setLeaderboardMessage('No learners have joined yet. Be the first!');return}
  setLeaderboardMessage('Friendly community ranking · progress is self-reported by the app.');
  communityProfiles=new Map(data.map(row=>[row.user_id,row]));
  leaderboard.innerHTML=data.map((row,index)=>{const isYou=row.user_id===user?.id;return`<article class="leaderboard-row ${isYou?'is-you':''}" data-community-user="${row.user_id}" tabindex="0" role="button" aria-label="View ${esc(row.display_name)}'s profile"><span class="leaderboard-rank">${index+1}</span><img src="${avatarImage(row.avatar_key,row.streak)}" alt="${esc(row.display_name)}'s Kaishi character"><div><strong>${esc(row.display_name)}${isYou?'<span class="you-badge">Your profile</span>':''}</strong><small>@${esc(row.github_login)}</small></div><b>${Number(row.xp).toLocaleString()} XP</b><small>${row.mastered} mastered · ${row.accuracy}% · ${row.streak||0} day rhythm</small></article>`}).join('');
  document.querySelectorAll('[data-community-user]').forEach(item=>{
   item.addEventListener('click',()=>openCommunityProfile(item.dataset.communityUser));
   item.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '){
     event.preventDefault();
     openCommunityProfile(item.dataset.communityUser);
    }
   });
  });
 }
 async function changeAvatar(event){const button=event.target.closest('[data-avatar]');if(!button)return;const definition=avatarDefinition(button.dataset.avatar);if(!user){toast('Sign in to choose and sync a Kaishi character');return}if(!avatarUnlocked(button.dataset.avatar)){toast(`${definition?.name||'This character'} unlocks at ${definition?.mastered||0} mastered words`);return}selectedAvatar=avatarKey(button.dataset.avatar);renderAvatarPicker();renderDashboardAvatar();const accountAvatar=account?.querySelector('img');if(accountAvatar)accountAvatar.src=avatarImage(selectedAvatar,adapter()?.stats?.().streak);const{error}=await client.from('leaderboard_entries').update({avatar_key:selectedAvatar}).eq('user_id',user.id);if(error){setStatus(describeError(error),'error');return}setStatus(`${definition?.name||'Kaishi character'} saved.`,'ok');await loadLeaderboard()}
 async function changeOptIn(){if(!user)return;join.disabled=true;const{error}=await client.from('leaderboard_entries').update({opted_in:join.checked}).eq('user_id',user.id);join.disabled=false;if(error){join.checked=!join.checked;setStatus(describeError(error),'error');return}setStatus(join.checked?'You have joined the public leaderboard.':'You have left the public leaderboard.','ok');await loadLeaderboard()}
 async function syncNow(){if(!user){await signIn();return}await initialiseAccount(true)}
 async function deleteCloudData(){if(!user||!confirm('Delete your Kaishi Japanese cloud account, progress and leaderboard entry? Local progress on this device will remain.'))return;const{error}=await client.rpc('delete_my_kaishi_account');if(error){setStatus(describeError(error),'error');return}await client.auth.signOut({scope:'local'});localStorage.removeItem(FP_KEY);renderSignedOut('Cloud account deleted. Local progress was kept on this device.');await loadLeaderboard()}
 async function handleSession(session){user=session?.user||null;window.dispatchEvent(new CustomEvent('kaishi-auth-change',{detail:{signedIn:Boolean(user),userId:user?.id||null}}));if(!user){renderSignedOut();await loadLeaderboard();return}renderStudioAccess();await loadEmailPreferences();if(isOwner()&&!adminUsersLoaded)loadAdminUsers();if(adapter()?.isTestMode?.()){const{data:entry}=await client.from('leaderboard_entries').select('*').eq('user_id',user.id).maybeSingle();renderSignedIn(entry||{});setStatus('Test learner is isolated. Cloud sync is paused.','ok');return}if(initialisedUserId===user.id)return;initialisedUserId=user.id;await initialiseAccount();await initialiseFriends();await redeemFriendInviteFromUrl()}


 function friendRelation(userId){
  return (window.__kaishiFriendRows||[]).find(row=>row.user_id===userId)||null;
 }
 async function openCommunityProfile(userId){
  const row=communityProfiles.get(userId),dialog=$('#communityProfileDialog');
  if(!row||!dialog)return;
  $('#communityProfileAvatar').src=friendAvatar(row);
  $('#communityProfileName').textContent=row.display_name||row.github_login;
  $('#communityProfileUsername').textContent=`@${row.github_login}`;
  $('#communityProfileStats').innerHTML=`<span><strong>${Number(row.xp||0).toLocaleString()}</strong> XP</span><span><strong>${row.mastered||0}</strong> mastered</span><span><strong>${row.streak||0}</strong> day rhythm</span>`;
  const relation=friendRelation(userId),actions=$('#communityProfileActions'),isYou=userId===user?.id;
  actions.innerHTML='';
  if(isYou){
   $('#communityProfileStatus').textContent='This is your community profile.';
  }else if(!user){
   $('#communityProfileStatus').textContent='Sign in to add this learner as a friend.';
   actions.innerHTML='<button id="profileSignIn" class="primary">Sign in with GitHub</button>';
   $('#profileSignIn').onclick=signIn;
  }else if(relation?.relationship_status==='accepted'){
   $('#communityProfileStatus').textContent='You are friends.';
   actions.innerHTML='<button id="profileUnfriend">Unfriend</button>';
   $('#profileUnfriend').onclick=async()=>{
    if(!confirm('Remove this friend?'))return;
    await friendRpc('remove_kaishi_friend',{friend_user_id:userId});
    await loadFriends();await loadLeaderboard();dialog.close();
   };
  }else if(relation?.relationship_status==='pending_incoming'){
   $('#communityProfileStatus').textContent='This learner sent you a friend request.';
   actions.innerHTML='<button id="profileAccept" class="primary">Accept request</button><button id="profileDecline">Decline</button>';
   $('#profileAccept').onclick=async()=>{
    await friendRpc('respond_kaishi_friend_request',{request_id:relation.request_id,accept_request:true});
    await loadFriends();await loadLeaderboard();dialog.close();
   };
   $('#profileDecline').onclick=async()=>{
    await friendRpc('respond_kaishi_friend_request',{request_id:relation.request_id,accept_request:false});
    await loadFriends();await loadLeaderboard();dialog.close();
   };
  }else if(relation?.relationship_status==='pending_outgoing'){
   $('#communityProfileStatus').textContent='Friend request sent. Waiting for them to accept.';
  }else{
   $('#communityProfileStatus').textContent='Send this learner a friend request.';
   actions.innerHTML='<button id="profileAddFriend" class="primary">Add friend</button>';
   $('#profileAddFriend').onclick=async()=>{
    const button=$('#profileAddFriend');
    button.disabled=true;button.textContent='Sending…';
    try{
     await friendRpc('send_kaishi_friend_request',{target_login:row.github_login});
     await loadFriends();await loadLeaderboard();
     $('#communityProfileStatus').textContent='Friend request sent. Waiting for them to accept.';
     actions.innerHTML='';
    }catch(error){
     button.disabled=false;button.textContent='Add friend';
     $('#communityProfileStatus').textContent=describeError(error);
    }
   };
  }
  if(!dialog.open)dialog.showModal();
 }
 function capturePendingInvite(){
  try{
   const url=new URL(location.href),token=url.searchParams.get('friendInvite');
   if(token)localStorage.setItem(PENDING_INVITE_KEY,token);
  }catch(error){console.warn('Could not retain friend invitation',error)}
 }
 function pendingInviteToken(){
  try{
   const url=new URL(location.href);
   return url.searchParams.get('friendInvite')||localStorage.getItem(PENDING_INVITE_KEY)||'';
  }catch(error){
   try{return localStorage.getItem(PENDING_INVITE_KEY)||''}catch{return''}
  }
 }
 function clearPendingInvite(){
  try{
   localStorage.removeItem(PENDING_INVITE_KEY);
   const url=new URL(location.href);
   url.searchParams.delete('friendInvite');
   history.replaceState({},'',url.toString());
  }catch(error){}
 }
 async function createFriendInviteLink(){
  if(!user){
   await signIn();
   return null;
  }
  const token=await friendRpc('create_kaishi_friend_invite');
  const url=new URL(location.href);
  url.hash='';
  url.searchParams.set('friendInvite',token);
  return url.toString();
 }
 async function redeemFriendInviteFromUrl(){
  if(!user)return false;
  const token=pendingInviteToken();
  if(!token)return false;
  try{
   const result=await friendRpc('redeem_kaishi_friend_invite',{invite_token:token});
   clearPendingInvite();
   await loadFriends();await loadLeaderboard();
   if(result?.inviter_login)toast(`You and @${result.inviter_login} are now Kaishi Japanese friends`);
   return true;
  }catch(error){
   clearPendingInvite();
   console.warn('Friend invite could not be redeemed',error);
   setStatus(describeError(error),'error');
   return false;
  }
 }


 function bindPersistentSocialDismissHandlers(){
  if(document.documentElement.dataset.socialDismissBound==='true')return;
  document.documentElement.dataset.socialDismissBound='true';
  document.addEventListener('click',event=>{
   const nudgeDismiss=event.target.closest('#friendActivityDismiss');
   if(nudgeDismiss){
    event.preventDefault();event.stopImmediatePropagation();
    const dismissal={userId:nudgeDismiss.dataset.friendUser||'',activity:nudgeDismiss.dataset.friendActivity||''};
    try{localStorage.setItem(FRIEND_NUDGE_DISMISS_KEY,JSON.stringify(dismissal))}catch(error){}
    const card=nudgeDismiss.closest('#friendActivityNudge');
    if(card){card.hidden=true;card.style.display='none'}
    return;
   }
   const notificationDismiss=event.target.closest('[data-nx]');
   if(notificationDismiss){
    event.preventDefault();event.stopPropagation();
    const id=notificationDismiss.dataset.nx;
    let read={};try{read=JSON.parse(localStorage.getItem(SOCIAL_READ_KEY)||'{}')}catch(error){}
    read[id]=Date.now();
    try{localStorage.setItem(SOCIAL_READ_KEY,JSON.stringify(read))}catch(error){}
    const item=notificationDismiss.closest('.social-notification-item');
    if(item)item.remove();
    Promise.resolve(renderSocialNotifications(lastFriendRows)).catch(console.warn);
    return;
   }
  },true);
 }
 async function init(){
  if(enforceCanonicalOrigin())return;
  bindPersistentSocialDismissHandlers();
  capturePendingInvite();
  $('#socialNotificationButton')?.addEventListener('click',()=>{const p=$('#socialNotificationPanel');if(p)p.hidden=!p.hidden});$('#socialNotificationClose')?.addEventListener('click',()=>{const p=$('#socialNotificationPanel');if(p)p.hidden=true});$('#refreshAdminUsers')?.addEventListener('click',loadAdminUsers);$('#communityProfileClose')?.addEventListener('click',()=>$('#communityProfileDialog')?.close());$('#avatarPicker')?.addEventListener('click',changeAvatar);join?.addEventListener('change',changeOptIn);$('#learningEmailOptIn')?.addEventListener('change',setLearningEmailPreference);$('#cloudSyncNow')?.addEventListener('click',syncNow);$('#cloudDelete')?.addEventListener('click',deleteCloudData);$('#leaderboardSignIn')?.addEventListener('click',()=>user?$('#settingsBtn').click():signIn());$('#adminEmailPreview')?.addEventListener('click',previewAdminEmail);$('#adminEmailSend')?.addEventListener('click',sendAdminEmail);$('#adminEmailClose')?.addEventListener('click',()=>$('#adminEmailDialog')?.close());$('#adminEmailCancel')?.addEventListener('click',()=>$('#adminEmailDialog')?.close());$('#adminEmailTemplate')?.addEventListener('change',()=>{emailPreviewed=false;$('#adminEmailSend').disabled=true;setAdminEmailStatus('Template changed. Preview again before sending.')});
  if(!config?.url||!config?.publishableKey||!sdk?.createClient){renderSignedOut('Cloud sync could not start. Guest mode is still available.');setStatus('Cloud configuration or library is unavailable.','error');return}
  client=sdk.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  client.auth.onAuthStateChange((event,session)=>{if(['TOKEN_REFRESHED','USER_UPDATED'].includes(event))return;setTimeout(()=>handleSession(session),0)});
  const{data,error}=await client.auth.getSession();if(error){renderSignedOut();setStatus(describeError(error),'error')}else await handleSession(data.session);
  
  window.addEventListener('kaishi-sw-status',()=>renderSocialNotifications(lastFriendRows||[]));
  window.addEventListener('kaishi-offline-status',()=>renderSocialNotifications(lastFriendRows||[]));
  addEventListener('online',()=>user&&scheduleSync());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()});
 }
 window.KaishiCloud={scheduleSync,loadLeaderboard,loadFriends,createFriendInviteLink,flush,avatarImage,renderDashboardAvatar,isOwner,isSignedIn:()=>Boolean(user),currentUserId:()=>user?.id||null,resetProgress,currentAvatar:()=>selectedAvatar,loadAdminUsers,loadEmailAutomation};
 init();
})();
