// ═══════════════════════════════════════════════════════════════════════════
// MODULE: cloudinary — public image hosting (so WhatsApp can fetch the image)
// ═══════════════════════════════════════════════════════════════════════════
const cloudinary = {
  async upload(dataUrl, config) {
    if (!config.cloudinaryCloud || !config.cloudinaryPreset) {
      throw new Error('Cloudinary not configured (set Cloud Name + Upload Preset in Settings)');
    }
    const blob = await (await fetch(dataUrl)).blob();
    const fd = new FormData();
    fd.append('file', blob);
    fd.append('upload_preset', config.cloudinaryPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudinaryCloud}/image/upload`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cloudinary upload failed: ${res.status} — ${err.slice(0, 100)}`);
    }
    const json = await res.json();
    return json.secure_url;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MODULE: whatsappAPI — sends image messages via Cloudflare Worker → Gupshup
// ═══════════════════════════════════════════════════════════════════════════
const whatsappAPI = {
  async send({ phone, imageDataUrl, caption, config }) {
    // Strip non-digits, ensure country code prefix
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) throw new Error('Invalid phone number');
    const send_to = cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone;

    // ─── MOCK MODE ──────────────────────────────────────────────
    if (config.mockMode) {
      await new Promise(r => setTimeout(r, 900 + Math.random() * 600));
      // Simulate occasional failures so you see error handling
      if (Math.random() < 0.08) {
        throw new Error('Mock: customer not on WhatsApp');
      }
      return {
        messageId: 'mock_' + utils.uid('msg'),
        status: 'sent',
        mock: true,
        sentTo: send_to,
        sentAt: Date.now(),
        mediaUrl: 'https://mock-cdn.imagevault.app/' + utils.uid('img') + '.jpg',
      };
    }

    // ─── LIVE MODE (Cloudflare Worker → Gupshup) ────────────────
    if (!config.workerUrl) throw new Error('Worker URL not configured');

    // Step 1: upload image to Cloudinary to get a public HTTPS URL
    const mediaUrl = await cloudinary.upload(imageDataUrl, config);

    // Step 2: call your Cloudflare Worker
    const res = await fetch(config.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ send_to, caption, media_url: mediaUrl }),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.error) {
      throw new Error(result.error || `Send failed: ${res.status}`);
    }

    return {
      messageId: result.messageId || result.response?.id || utils.uid('msg'),
      status: 'sent',
      sentTo: send_to,
      sentAt: Date.now(),
      mediaUrl,
      raw: result,
    };
  },
};import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense, createContext, useContext } from 'react';
import { Search, Upload, Camera, Settings, LogOut, Plus, Trash2, Edit3, Share2, X, ChevronRight, ChevronDown, Tag, FolderTree, UserPlus, Mail, Key, Users, Image as ImageIcon, Check, AlertCircle, Home, Folder, Star, Sparkles, Layers, BarChart3, Globe, Download, Filter, Wand2, Palette, Shield, Link2, RotateCw, Sun, Droplet, Lock, Clock, TrendingUp, Award, Zap, FileText, Send, Copy, Pin, Phone, Loader2 } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════
const CFG = {
  META_KEY: 'iv_meta_v3',
  SESSION_KEY: 'iv_session_v3',
  IMG_PREFIX: 'iv_img_',
  PAGE_SIZE: 12,
  MAX_IMG_SIZE: 10 * 1024 * 1024,
  COMPRESS_W: 700,
  COMPRESS_Q: 0.7,
  THUMB_W: 200,
  THUMB_Q: 0.6,
  SESSION_TIMEOUT_MIN: 30,
  INVITE_EXPIRY_DAYS: 7,
  STORAGE_KEY_LIMIT: 4.5 * 1024 * 1024, // stay under 5MB per key
};

// ═══════════════════════════════════════════════════════════════════════════
// I18N
// ═══════════════════════════════════════════════════════════════════════════
const I18N = {
  en: { home: 'Home', search: 'Search', upload: 'Upload', settings: 'Settings', collections: 'Lookbooks', signin: 'Sign In', signout: 'Sign Out', welcome: 'Welcome back', images: 'Images', categories: 'Categories', subcategories: 'Subcategories', share: 'Share', delete: 'Delete', edit: 'Edit', save: 'Save', cancel: 'Cancel', add: 'Add', tagline: 'Bakery Visual Inventory', insights: 'Insights', keywords: 'Keywords', preferences: 'Preferences', users: 'Users', invites: 'Invites', backup: 'Backup', team: 'Team Members', role: 'Role', admin: 'Admin', operator: 'Operator', browse: 'Browse', filters: 'Filters', sortBy: 'Sort by', newest: 'Newest', alpha: 'A–Z', mostShared: 'Most shared', mostTagged: 'Most tagged', popular: 'Popular Keywords', noMatches: 'No matches', smartFolders: 'Smart Folders', clear: 'Clear', selectAll: 'Select all', deselectAll: 'Deselect all', selected: 'selected', tag: 'Tag', loadMore: 'Load more', noImages: 'No images yet', uploadFirst: 'Upload images to get started', bulkUpload: 'Bulk Upload', browseBtn: 'Browse', camera: 'Camera', drop: 'Drop images or browse', review: 'Review & Tag', applyAll: 'Apply to all', addKeyword: 'Add keyword...', name: 'Name', subcategory: 'Subcategory', uploading: 'Saving...', sendWA: 'Share via WhatsApp', message: 'Message', customerPhone: 'Customer phone (optional)', copyLink: 'Copy Public Link', send: 'Send', sessionExpired: 'Session expired', shares: 'Shares', operators: 'Active operators', trending: 'Trending Keywords', recentActivity: 'Recent Activity', leaderboard: 'Operator Leaderboard', topCategories: 'Top Categories', mgmtKeywords: 'Manage Keywords', mgmtCategories: 'Manage Categories', sendInvites: 'Send Invites', autoWM: 'Auto-watermark on upload', watermark: 'Watermark', branding: 'Branding', security: 'Security', language: 'Language', noCollections: 'No collections', newCollection: 'New Collection', create: 'Create', theme: 'Theme', addImages: 'Add images', exportPDF: 'PDF', shareCollection: 'Share', },
  hi: { home: 'होम', search: 'खोज', upload: 'अपलोड', settings: 'सेटिंग्स', collections: 'संग्रह', signin: 'साइन इन', signout: 'साइन आउट', welcome: 'वापस स्वागत', images: 'छवियां', categories: 'श्रेणियां', subcategories: 'उप-श्रेणियां', share: 'शेयर', delete: 'हटाएं', edit: 'संपादित', save: 'सहेजें', cancel: 'रद्द', add: 'जोड़ें', tagline: 'बेकरी दृश्य सूची', insights: 'विश्लेषण', keywords: 'कीवर्ड', preferences: 'प्राथमिकताएं', users: 'उपयोगकर्ता', invites: 'आमंत्रण', backup: 'बैकअप', team: 'टीम सदस्य', role: 'भूमिका', admin: 'व्यवस्थापक', operator: 'ऑपरेटर', browse: 'ब्राउज़', filters: 'फ़िल्टर', sortBy: 'क्रमबद्ध', newest: 'नवीनतम', alpha: 'अ–ज्ञ', mostShared: 'सबसे ज्यादा शेयर', mostTagged: 'सबसे ज्यादा टैग', popular: 'लोकप्रिय कीवर्ड', noMatches: 'कोई मिलान नहीं', smartFolders: 'स्मार्ट फ़ोल्डर', clear: 'साफ़', selectAll: 'सभी चुनें', deselectAll: 'सभी अचयनित', selected: 'चयनित', tag: 'टैग', loadMore: 'और लोड करें', noImages: 'अभी तक कोई छवि नहीं', uploadFirst: 'शुरू करने के लिए अपलोड करें', bulkUpload: 'थोक अपलोड', browseBtn: 'ब्राउज़', camera: 'कैमरा', drop: 'छवियां छोड़ें या ब्राउज़ करें', review: 'समीक्षा और टैग', applyAll: 'सभी पर लागू करें', addKeyword: 'कीवर्ड जोड़ें...', name: 'नाम', subcategory: 'उप-श्रेणी', uploading: 'सहेज रहे हैं...', sendWA: 'व्हाट्सएप पर शेयर करें', message: 'संदेश', customerPhone: 'ग्राहक फ़ोन (वैकल्पिक)', copyLink: 'सार्वजनिक लिंक कॉपी करें', send: 'भेजें', sessionExpired: 'सत्र समाप्त', shares: 'शेयर', operators: 'सक्रिय ऑपरेटर', trending: 'ट्रेंडिंग कीवर्ड', recentActivity: 'हाल की गतिविधि', leaderboard: 'ऑपरेटर लीडरबोर्ड', topCategories: 'शीर्ष श्रेणियां', mgmtKeywords: 'कीवर्ड प्रबंधित करें', mgmtCategories: 'श्रेणियां प्रबंधित करें', sendInvites: 'आमंत्रण भेजें', autoWM: 'अपलोड पर ऑटो-वॉटरमार्क', watermark: 'वॉटरमार्क', branding: 'ब्रांडिंग', security: 'सुरक्षा', language: 'भाषा', noCollections: 'कोई संग्रह नहीं', newCollection: 'नया संग्रह', create: 'बनाएं', theme: 'थीम', addImages: 'छवियां जोड़ें', exportPDF: 'पीडीएफ', shareCollection: 'शेयर', },
  pa: { home: 'ਘਰ', search: 'ਖੋਜ', upload: 'ਅਪਲੋਡ', settings: 'ਸੈਟਿੰਗਾਂ', collections: 'ਸੰਗ੍ਰਹਿ', signin: 'ਸਾਈਨ ਇਨ', signout: 'ਸਾਈਨ ਆਊਟ', welcome: 'ਵਾਪਸ ਜੀ ਆਇਆਂ', images: 'ਤਸਵੀਰਾਂ', categories: 'ਸ਼੍ਰੇਣੀਆਂ', subcategories: 'ਉਪ-ਸ਼੍ਰੇਣੀਆਂ', share: 'ਸਾਂਝਾ', delete: 'ਮਿਟਾਓ', edit: 'ਸੰਪਾਦਿਤ', save: 'ਸੰਭਾਲੋ', cancel: 'ਰੱਦ', add: 'ਜੋੜੋ', tagline: 'ਬੇਕਰੀ ਵਿਜ਼ੂਅਲ ਇਨਵੈਂਟਰੀ', insights: 'ਵਿਸ਼ਲੇਸ਼ਣ', keywords: 'ਕੀਵਰਡ', preferences: 'ਤਰਜੀਹਾਂ', users: 'ਉਪਭੋਗਤਾ', invites: 'ਸੱਦੇ', backup: 'ਬੈਕਅੱਪ', team: 'ਟੀਮ ਮੈਂਬਰ', role: 'ਭੂਮਿਕਾ', admin: 'ਪ੍ਰਬੰਧਕ', operator: 'ਓਪਰੇਟਰ', browse: 'ਬ੍ਰਾਊਜ਼', filters: 'ਫਿਲਟਰ', sortBy: 'ਕ੍ਰਮਬੱਧ', newest: 'ਨਵੀਨਤਮ', alpha: 'ਅ–ਜ਼', mostShared: 'ਸਭ ਤੋਂ ਵੱਧ ਸਾਂਝੇ', mostTagged: 'ਸਭ ਤੋਂ ਵੱਧ ਟੈਗ', popular: 'ਪ੍ਰਸਿੱਧ ਕੀਵਰਡ', noMatches: 'ਕੋਈ ਮੇਲ ਨਹੀਂ', smartFolders: 'ਸਮਾਰਟ ਫੋਲਡਰ', clear: 'ਸਾਫ਼', selectAll: 'ਸਭ ਚੁਣੋ', deselectAll: 'ਸਭ ਅਣ-ਚੁਣੇ', selected: 'ਚੁਣੇ', tag: 'ਟੈਗ', loadMore: 'ਹੋਰ ਲੋਡ ਕਰੋ', noImages: 'ਕੋਈ ਤਸਵੀਰਾਂ ਨਹੀਂ', uploadFirst: 'ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਅਪਲੋਡ ਕਰੋ', bulkUpload: 'ਥੋਕ ਅਪਲੋਡ', browseBtn: 'ਬ੍ਰਾਊਜ਼', camera: 'ਕੈਮਰਾ', drop: 'ਤਸਵੀਰਾਂ ਛੱਡੋ ਜਾਂ ਬ੍ਰਾਊਜ਼ ਕਰੋ', review: 'ਸਮੀਖਿਆ ਅਤੇ ਟੈਗ', applyAll: 'ਸਭ ਤੇ ਲਾਗੂ ਕਰੋ', addKeyword: 'ਕੀਵਰਡ ਜੋੜੋ...', name: 'ਨਾਮ', subcategory: 'ਉਪ-ਸ਼੍ਰੇਣੀ', uploading: 'ਸੰਭਾਲ ਰਹੇ ਹਾਂ...', sendWA: 'ਵਟਸਐਪ ਤੇ ਸਾਂਝਾ ਕਰੋ', message: 'ਸੁਨੇਹਾ', customerPhone: 'ਗਾਹਕ ਫੋਨ (ਵਿਕਲਪਿਕ)', copyLink: 'ਜਨਤਕ ਲਿੰਕ ਕਾਪੀ ਕਰੋ', send: 'ਭੇਜੋ', sessionExpired: 'ਸੈਸ਼ਨ ਖਤਮ', shares: 'ਸਾਂਝੇ', operators: 'ਸਰਗਰਮ ਓਪਰੇਟਰ', trending: 'ਟ੍ਰੈਂਡਿੰਗ ਕੀਵਰਡ', recentActivity: 'ਹਾਲੀਆ ਗਤੀਵਿਧੀ', leaderboard: 'ਓਪਰੇਟਰ ਲੀਡਰਬੋਰਡ', topCategories: 'ਸਿਖਰ ਸ਼੍ਰੇਣੀਆਂ', mgmtKeywords: 'ਕੀਵਰਡ ਪ੍ਰਬੰਧਨ', mgmtCategories: 'ਸ਼੍ਰੇਣੀਆਂ ਪ੍ਰਬੰਧਨ', sendInvites: 'ਸੱਦੇ ਭੇਜੋ', autoWM: 'ਅਪਲੋਡ ਤੇ ਆਟੋ-ਵਾਟਰਮਾਰਕ', watermark: 'ਵਾਟਰਮਾਰਕ', branding: 'ਬ੍ਰਾਂਡਿੰਗ', security: 'ਸੁਰੱਖਿਆ', language: 'ਭਾਸ਼ਾ', noCollections: 'ਕੋਈ ਸੰਗ੍ਰਹਿ ਨਹੀਂ', newCollection: 'ਨਵਾਂ ਸੰਗ੍ਰਹਿ', create: 'ਬਣਾਓ', theme: 'ਥੀਮ', addImages: 'ਤਸਵੀਰਾਂ ਜੋੜੋ', exportPDF: 'PDF', shareCollection: 'ਸਾਂਝਾ', },
};

// ═══════════════════════════════════════════════════════════════════════════
// MODULE: roles — Permission system (single source of truth)
// ═══════════════════════════════════════════════════════════════════════════
const ROLES = {
  admin:    { label: 'Admin',    icon: '👑', tier: 3, color: 'bg-purple-100 text-purple-700', desc: 'Full system control' },
  manager:  { label: 'Manager',  icon: '🎯', tier: 2, color: 'bg-blue-100 text-blue-700',     desc: 'Operations + team management' },
  operator: { label: 'Operator', icon: '👤', tier: 1, color: 'bg-slate-100 text-slate-700',   desc: 'Upload, tag, share' },
};

// Permissions: action → minimum tier OR custom check function
// tier 3 = admin only, tier 2 = manager+, tier 1 = everyone
const PERMS = {
  // Browse / search / share — everyone
  'image.view':         1,
  'image.share':        1,
  'image.upload':       1,
  // Editing
  'image.edit_own':     1,  // edit keywords on images you uploaded
  'image.edit_any':     2,  // edit any image's keywords
  'image.delete':       2,
  'image.bulk':         2,  // bulk tag/share/delete
  // Categories
  'category.create':    2,
  'category.edit':      2,
  'category.delete':    3,  // admin only
  // Lookbooks
  'collection.create':  1,
  'collection.edit':    1,  // edit own
  'collection.delete':  2,
  // Users
  'user.invite':        2,
  'user.invite_manager': 3, // only admin can invite managers
  'user.promote':       3,
  'user.remove':        3,
  // System
  'system.whatsapp':    3,
  'system.preferences': 3,
  'system.backup':      3,
  'system.restore':     3,
  // Visibility
  'view.insights':      2,
  'view.activity_log':  2,
  'view.customer_book': 1,
  'customer.edit':      2,
  // 2FA at login (manager + admin require)
  'auth.requires_2fa':  2,
};

const can = (session, action, resource = null) => {
  if (!session) return false;
  const userTier = ROLES[session.role]?.tier || 0;
  const required = PERMS[action];
  if (required === undefined) return false; // unknown action = deny
  // Special-case: edit_own — operator can edit their own uploads
  if (action === 'image.edit_own' && resource && resource.uploadedBy === session.email) return true;
  if (action === 'collection.edit' && resource && resource.createdBy === session.email) return true;
  return userTier >= required;
};

const roleBadge = (role) => {
  const r = ROLES[role] || ROLES.operator;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${r.color}`}>
      <span>{r.icon}</span>{r.label}
    </span>
  );
};

// Universal clipboard helper with fallback
const copyToClipboard = async (text) => {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
};

// Trigger download of a data URL
const downloadDataUrl = (dataUrl, filename) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// ═══════════════════════════════════════════════════════════════════════════
// SEED DATA (metadata only — no image base64)
// ═══════════════════════════════════════════════════════════════════════════
const SEED = {
  users: [],
  inviteCodes: [],
  categories: [
    { id: 'c1', name: 'Cakes', icon: '🎂', subcategories: [{ id: 's1', name: 'Birthday Cakes' }, { id: 's2', name: 'Wedding Cakes' }, { id: 's3', name: 'Anniversary Cakes' }, { id: 's4', name: 'Custom Theme Cakes' }] },
    { id: 'c2', name: 'Cookies & Biscuits', icon: '🍪', subcategories: [{ id: 's5', name: 'Festive Cookies' }, { id: 's6', name: 'Gift Tins' }, { id: 's7', name: 'Everyday Biscuits' }] },
    { id: 'c3', name: 'Chocolates & Truffles', icon: '🍫', subcategories: [{ id: 's8', name: 'Assorted Chocolate Box' }, { id: 's9', name: 'Handmade Truffles' }, { id: 's10', name: 'Chocolate Bars' }] },
    { id: 'c4', name: 'Hampers', icon: '🎁', subcategories: [{ id: 's11', name: 'Diwali Hampers' }, { id: 's12', name: 'Wedding Hampers' }, { id: 's13', name: 'Corporate Hampers' }, { id: 's14', name: 'Personalized Hampers' }] },
    { id: 'c5', name: 'Indian Sweets', icon: '🍬', subcategories: [{ id: 's15', name: 'Mithai Box' }, { id: 's16', name: 'Dryfruit Sweets' }, { id: 's17', name: 'Festive Mithai' }] },
    { id: 'c6', name: 'Breads & Pastries', icon: '🥐', subcategories: [{ id: 's18', name: 'Artisan Breads' }, { id: 's19', name: 'French Pastries' }, { id: 's20', name: 'Croissants & Danishes' }] },
  ],
  images: [], // metadata only: { id, name, categoryId, subcategoryId, keywords, thumbnail, hash, colors, uploadedBy, uploadedAt }
  collections: [],
  smartFolders: [],
  shareLog: [],
  activityLog: [],
  favorites: [],
  pinned: [],
  publicCatalogs: [],
  settings: { lang: 'en', watermarkText: '🍰 Brinda Sweets Baker\'s Lounge', sessionTimeoutMin: 30, autoWatermark: false, brandName: 'Brinda Sweets Baker\'s Lounge', inviteMessage: `🎉 *You're invited to ImageVault* 🎉\n\nHi! You've been invited to join our image catalog system.\n\n📌 *INVITE CODE:* {{code}}\n📧 *EMAIL:* {{email}}\n⏰ *EXPIRES:* {{expires}}\n\nTo get started:\n1. Open the ImageVault app\n2. Tap "Join with Invite"\n3. Enter your email + the code above\n\n— {{brand}}`, gupshup: { enabled: false, mockMode: true, workerUrl: '', sourceNumber: '917527818018', defaultCaption: "Hello! 👋 Here's the item from the catalog you asked.", cloudinaryCloud: '', cloudinaryPreset: '' } },
  customers: [],
  waMessageLog: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// MODULE: imageRepo — Lazy image loading with separate keys + in-memory cache
// ═══════════════════════════════════════════════════════════════════════════
const imageCache = new Map();
const inflight = new Map();

const imageRepo = {
  async getFull(id) {
    if (imageCache.has(id)) return imageCache.get(id);
    if (inflight.has(id)) return inflight.get(id);
    const promise = (async () => {
      try {
        if (!window.storage) return null;
        const r = await window.storage.get(CFG.IMG_PREFIX + id).catch(() => null);
        if (r?.value) {
          imageCache.set(id, r.value);
          return r.value;
        }
      } catch (e) { console.error('[imageRepo] get error', id, e); }
      return null;
    })();
    inflight.set(id, promise);
    promise.finally(() => inflight.delete(id));
    return promise;
  },
  async putFull(id, dataUrl) {
    try {
      imageCache.set(id, dataUrl);
      if (window.storage) {
        if (dataUrl.length > CFG.STORAGE_KEY_LIMIT) {
          throw new Error(`Image too large for storage: ${(dataUrl.length / 1024 / 1024).toFixed(2)}MB`);
        }
        await window.storage.set(CFG.IMG_PREFIX + id, dataUrl);
      }
      return true;
    } catch (e) {
      console.error('[imageRepo] put error', id, e);
      throw e;
    }
  },
  async remove(id) {
    imageCache.delete(id);
    try {
      if (window.storage) await window.storage.delete(CFG.IMG_PREFIX + id).catch(() => {});
    } catch {}
  },
  clearCache() { imageCache.clear(); },
};

// ═══════════════════════════════════════════════════════════════════════════
// MODULE: storage — Metadata persistence
// ═══════════════════════════════════════════════════════════════════════════
const storage = {
  async loadMeta() {
    try {
      if (!window.storage) return SEED;
      const r = await window.storage.get(CFG.META_KEY).catch(() => null);
      if (r?.value) {
        const parsed = JSON.parse(r.value);
        return { ...SEED, ...parsed };
      }
    } catch (e) { console.error('[storage] loadMeta error', e); }
    return SEED;
  },
  async saveMeta(data) {
    try {
      if (!window.storage) return;
      // Strip any accidental dataUrls from images array
      const clean = {
        ...data,
        images: (data.images || []).map(({ dataUrl, ...meta }) => meta),
      };
      const json = JSON.stringify(clean);
      if (json.length > CFG.STORAGE_KEY_LIMIT) {
        console.warn('[storage] meta size', (json.length / 1024).toFixed(0), 'KB — approaching limit');
      }
      await window.storage.set(CFG.META_KEY, json);
      return true;
    } catch (e) { console.error('[storage] saveMeta error', e); throw e; }
  },
  async loadSession() {
    try {
      if (!window.storage) return null;
      const r = await window.storage.get(CFG.SESSION_KEY).catch(() => null);
      if (r?.value) return JSON.parse(r.value);
    } catch {}
    return null;
  },
  async saveSession(s) {
    try {
      if (!window.storage) return;
      if (s) await window.storage.set(CFG.SESSION_KEY, JSON.stringify(s));
      else await window.storage.delete(CFG.SESSION_KEY).catch(() => {});
    } catch {}
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MODULE: utils — pure helpers
// ═══════════════════════════════════════════════════════════════════════════
const utils = {
  uid: (p = 'id') => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  bytes: b => b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'KB' : (b / 1048576).toFixed(1) + 'MB',
  date: ts => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  ago: ts => {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  },
  hash: dataUrl => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let h = '', avg = 0;
      const grays = [];
      for (let i = 0; i < d.length; i += 4) { const g = (d[i] + d[i+1] + d[i+2]) / 3; grays.push(g); avg += g; }
      avg /= 64;
      grays.forEach(g => h += g > avg ? '1' : '0');
      resolve(h);
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  }),
  hamming: (a, b) => { if (!a || !b || a.length !== b.length) return 999; let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; },
  colors: dataUrl => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 40; c.height = 40;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 40, 40);
      const d = ctx.getImageData(0, 0, 40, 40).data;
      const buckets = {};
      for (let i = 0; i < d.length; i += 16) {
        const r = Math.round(d[i] / 32) * 32;
        const g = Math.round(d[i+1] / 32) * 32;
        const b = Math.round(d[i+2] / 32) * 32;
        const k = `${r},${g},${b}`;
        buckets[k] = (buckets[k] || 0) + 1;
      }
      const top = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([rgb]) => { const [r,g,b] = rgb.split(',').map(Number); return `rgb(${r},${g},${b})`; });
      resolve(top);
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  }),
  // Compress and produce both full + thumbnail
  process: file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const make = (maxW, q) => {
          const c = document.createElement('canvas');
          const scale = Math.min(1, maxW / img.width);
          c.width = img.width * scale;
          c.height = img.height * scale;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL('image/jpeg', q);
        };
        resolve({ full: make(CFG.COMPRESS_W, CFG.COMPRESS_Q), thumb: make(CFG.THUMB_W, CFG.THUMB_Q) });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  }),
  watermark: (dataUrl, settings) => new Promise(resolve => {
    const text = settings?.watermarkText || '';
    const logoDataUrl = settings?.watermarkLogo || null;
    const position = settings?.watermarkPosition || 'bottom-right';
    const opacity = settings?.watermarkOpacity ?? 0.85;
    const sizePct = settings?.watermarkSize ?? 30;

    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const renderAt = (x, y, alignH, alignV) => {
        if (logoDataUrl) {
          // Logo watermark
          const logoImg = new Image();
          return new Promise(res => {
            logoImg.onload = () => {
              const wmW = (img.width * sizePct) / 100;
              const ratio = logoImg.height / logoImg.width;
              const wmH = wmW * ratio;
              const dx = alignH === 'right' ? x - wmW : alignH === 'center' ? x - wmW / 2 : x;
              const dy = alignV === 'bottom' ? y - wmH : alignV === 'middle' ? y - wmH / 2 : y;
              ctx.globalAlpha = opacity;
              ctx.drawImage(logoImg, dx, dy, wmW, wmH);
              ctx.globalAlpha = 1;
              res();
            };
            logoImg.onerror = () => res();
            logoImg.src = logoDataUrl;
          });
        } else if (text) {
          const fs = Math.max(14, img.width / 30);
          ctx.font = `bold ${fs}px sans-serif`;
          ctx.fillStyle = `rgba(255,255,255,${opacity})`;
          ctx.strokeStyle = `rgba(0,0,0,${opacity * 0.7})`;
          ctx.lineWidth = 3;
          ctx.textAlign = alignH;
          ctx.textBaseline = alignV;
          ctx.strokeText(text, x, y);
          ctx.fillText(text, x, y);
          return Promise.resolve();
        }
        return Promise.resolve();
      };

      const positions = {
        'top-left':     [20, 20, 'left', 'top'],
        'top-right':    [img.width - 20, 20, 'right', 'top'],
        'bottom-left':  [20, img.height - 20, 'left', 'bottom'],
        'bottom-right': [img.width - 20, img.height - 20, 'right', 'bottom'],
        'center':       [img.width / 2, img.height / 2, 'center', 'middle'],
      };
      const p = positions[position] || positions['bottom-right'];

      renderAt(...p).then(() => resolve(c.toDataURL('image/jpeg', 0.85)));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  }),
  edits: (dataUrl, { rotate = 0, brightness = 100 }) => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const w = (rotate % 180 === 0) ? img.width : img.height;
      const h = (rotate % 180 === 0) ? img.height : img.width;
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.filter = `brightness(${brightness}%)`;
      ctx.translate(w/2, h/2);
      ctx.rotate(rotate * Math.PI / 180);
      ctx.drawImage(img, -img.width/2, -img.height/2);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  }),
};

// ═══════════════════════════════════════════════════════════════════════════
// MODULE: aiVision
// ═══════════════════════════════════════════════════════════════════════════
const aiVision = {
  async autoTag(dataUrl) {
    try {
      const base64 = dataUrl.split(',')[1];
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
              { type: "text", text: "Bakery cataloger: suggest 5-8 short keyword tags (lowercase, single or 2-word) describing item type, color, occasion, ingredients, style. Respond with ONLY a JSON array. Example: [\"chocolate\",\"birthday\",\"pink fondant\"]" }
            ]
          }]
        })
      });
      const data = await r.json();
      const text = data.content?.find(b => b.type === 'text')?.text || '[]';
      const tags = JSON.parse(text.replace(/```json|```/g, '').trim());
      return Array.isArray(tags) ? tags.map(t => String(t).toLowerCase()).slice(0, 8) : [];
    } catch (e) { console.error('[ai] tag error', e); return []; }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════
const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

// ═══════════════════════════════════════════════════════════════════════════
// LAZY-LOADED IMAGE — Intersection Observer + cache
// ═══════════════════════════════════════════════════════════════════════════
function LazyImage({ id, thumbnail, alt = '', className = '', useFull = false }) {
  const [src, setSrc] = useState(thumbnail || '');
  const [loaded, setLoaded] = useState(!!thumbnail);
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || visible) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: '100px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !id) return;
    let cancel = false;
    if (useFull || !thumbnail) {
      imageRepo.getFull(id).then(full => {
        if (!cancel && full) { setSrc(full); setLoaded(true); }
      });
    }
    return () => { cancel = true; };
  }, [visible, id, useFull, thumbnail]);

  return (
    <div ref={ref} className={`relative bg-slate-100 ${className}`}>
      {!loaded && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-5 h-5 text-slate-300 animate-spin" /></div>}
      {src && <img src={src} alt={alt} className={`w-full h-full object-cover ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity`} onLoad={() => setLoaded(true)} loading="lazy" />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LAZY TAB MODULES (code-split)
// ═══════════════════════════════════════════════════════════════════════════
const TabFallback = () => <div className="p-8 text-center"><Loader2 className="w-6 h-6 text-blue-500 animate-spin mx-auto" /></div>;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [data, setData] = useState(SEED);
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [lang, setLang] = useState('en');
  const lastActivity = useRef(Date.now());

  // Boot
  useEffect(() => {
    (async () => {
      const d = await storage.loadMeta();
      setData(d);
      if (d.settings?.lang) setLang(d.settings.lang);
      const s = await storage.loadSession();
      if (s) {
        const tm = (d.settings?.sessionTimeoutMin || 30) * 60000;
        if (Date.now() - (s.lastActive || 0) < tm) setSession(s);
        else await storage.saveSession(null);
      }
      setLoading(false);
    })();
  }, []);

  // Session timeout monitor
  useEffect(() => {
    if (!session) return;
    const tick = setInterval(() => {
      const tm = (data.settings?.sessionTimeoutMin || 30) * 60000;
      if (Date.now() - lastActivity.current > tm) {
        showToast('Session expired', 'error');
        persistSession(null);
      }
    }, 60000);
    const handler = () => { lastActivity.current = Date.now(); };
    window.addEventListener('click', handler);
    window.addEventListener('keydown', handler);
    return () => { clearInterval(tick); window.removeEventListener('click', handler); window.removeEventListener('keydown', handler); };
  }, [session, data.settings?.sessionTimeoutMin]);

  const persistData = useCallback(async (d) => {
    setData(d);
    try { await storage.saveMeta(d); }
    catch (e) {
      setToast({ message: 'Storage error: ' + e.message, type: 'error', id: Date.now() });
      setTimeout(() => setToast(null), 4000);
    }
  }, []);

  const persistSession = useCallback(async (s) => {
    const enriched = s ? { ...s, lastActive: Date.now() } : null;
    setSession(enriched);
    await storage.saveSession(enriched);
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToast({ message, type, id });
    setTimeout(() => setToast(t => t?.id === id ? null : t), 3000);
  }, []);

  const logActivity = useCallback((action, detail) => {
    setData(prev => {
      const log = { id: utils.uid('log'), action, detail, user: session?.email, ts: Date.now() };
      const next = { ...prev, activityLog: [log, ...(prev.activityLog || [])].slice(0, 200) };
      storage.saveMeta(next).catch(() => {});
      return next;
    });
  }, [session]);

  const t = I18N[lang] || I18N.en;
  const ctxVal = useMemo(() => ({ data, persistData, session, persistSession, showToast, logActivity, t, lang, setLang }), [data, persistData, session, persistSession, showToast, logActivity, t, lang]);

  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;
  }

  const isDark = data.settings?.theme === 'dark';
  const themeWrapper = isDark ? 'dark' : '';

  if (!session) return <Ctx.Provider value={ctxVal}><div className={themeWrapper}><LoginScreen /></div></Ctx.Provider>;

  return (
    <Ctx.Provider value={ctxVal}>
      <div className={`${themeWrapper} ${isDark ? 'bg-slate-900' : 'bg-slate-50'} min-h-screen`}>
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 pb-20">
            <Suspense fallback={<TabFallback />}>
              {activeTab === 'home' && <HomeTab setActiveTab={setActiveTab} />}
              {activeTab === 'search' && <SearchTab />}
              {activeTab === 'upload' && <UploadTab />}
              {activeTab === 'collections' && <CollectionsTab />}
              {activeTab === 'campaigns' && <CampaignsTab />}
              {activeTab === 'settings' && <SettingsTab onLogout={() => persistSession(null)} />}
            </Suspense>
          </main>
          <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
          <UniversalSearch />
          {toast && <Toast {...toast} />}
        </div>
      </div>
    </Ctx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════════
function Toast({ message, type }) {
  return (
    <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[100] px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 max-w-[90vw] ${type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
      {type === 'error' ? <AlertCircle className="w-4 h-4 flex-shrink-0" /> : <Check className="w-4 h-4 flex-shrink-0" />}
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════════════
function LoginScreen() {
  const { data, persistData, persistSession, showToast, t, lang, setLang } = useApp();
  const isFirstTime = data.users.length === 0;
  const [mode, setMode] = useState(isFirstTime ? 'setup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [code, setCode] = useState('');
  const [twoFA, setTwoFA] = useState('');
  const [need2FA, setNeed2FA] = useState(false);
  const [tempUser, setTempUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  // Simple password hash (for prototype — production should use proper bcrypt server-side)
  const hashPassword = (pw) => {
    let h = 0;
    for (let i = 0; i < pw.length; i++) { h = ((h << 5) - h) + pw.charCodeAt(i); h |= 0; }
    return 'h_' + h.toString(36) + '_' + pw.length;
  };

  // ─── First-time setup: create the founding Admin ────────────────
  const setupAdmin = async () => {
    if (!brandName.trim()) return showToast('Enter your bakery name', 'error');
    if (!name.trim()) return showToast('Enter your name', 'error');
    if (!email.includes('@')) return showToast('Invalid email', 'error');
    if (password.length < 6) return showToast('Password must be at least 6 characters', 'error');
    if (password !== confirmPassword) return showToast('Passwords do not match', 'error');
    const newAdmin = {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: 'admin',
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
    };
    await persistData({
      ...data,
      users: [newAdmin],
      settings: {
        ...data.settings,
        brandName: brandName.trim(),
        watermarkText: `🍰 ${brandName.trim()}`,
      },
    });
    persistSession(newAdmin);
    showToast(`Welcome, ${name.trim()}! Your bakery is ready 🎉`);
  };

  // ─── Returning user sign-in ─────────────────────────────────────
  const login = () => {
    const u = data.users.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (!u) return showToast('No account with this email', 'error');
    if (u.passwordHash !== hashPassword(password)) return showToast('Wrong password', 'error');
    if (can(u, 'auth.requires_2fa')) {
      setTempUser(u); setNeed2FA(true); showToast('2FA: type 123456 (demo)');
    } else {
      persistSession(u); showToast(`Welcome back, ${u.name}!`);
    }
  };

  const verify2FA = () => {
    if (twoFA === '123456') { persistSession(tempUser); showToast(`Welcome back, ${tempUser.name}!`); }
    else showToast('Invalid 2FA code', 'error');
  };

  // ─── Invite redemption (for Manager / Operator joining) ─────────
  const redeemInvite = async () => {
    if (!email || !code || !name || !password) return showToast('Fill all fields', 'error');
    if (password.length < 6) return showToast('Password must be at least 6 characters', 'error');
    if (password !== confirmPassword) return showToast('Passwords do not match', 'error');
    const inv = data.inviteCodes.find(i => i.code === code && !i.used);
    if (!inv) return showToast('Invalid or already-used invite code', 'error');
    if (inv.expiresAt && inv.expiresAt < Date.now()) return showToast('Invite has expired — ask admin to send a new one', 'error');
    if (inv.email.toLowerCase() !== email.toLowerCase()) return showToast('This invite is for a different email', 'error');
    const role = inv.role || 'operator';
    const newUser = {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
      invitedBy: inv.invitedBy || null,
    };
    await persistData({
      ...data,
      users: [...data.users, newUser],
      inviteCodes: data.inviteCodes.map(i => i.code === code ? { ...i, used: true, usedAt: Date.now() } : i),
    });
    persistSession(newUser);
    showToast(`Welcome, ${name}! You're signed in as ${ROLES[role].label}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-3">
          <select value={lang} onChange={e => setLang(e.target.value)} className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5">
            <option value="en">🇬🇧 English</option><option value="hi">🇮🇳 हिंदी</option><option value="pa">🇮🇳 ਪੰਜਾਬੀ</option>
          </select>
        </div>

        <div className="text-center mb-6">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 items-center justify-center mb-3 shadow-lg shadow-blue-200"><ImageIcon className="w-8 h-8 text-white" /></div>
          <h1 className="text-3xl font-bold text-slate-900">ImageVault <span className="text-base text-blue-600">Pro</span></h1>
          <p className="text-slate-500 mt-1 text-sm">{data.settings?.tagline || t.tagline}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 border border-slate-100">

          {/* ─── 2FA STEP ─── */}
          {need2FA && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-blue-600"><Shield className="w-5 h-5" /><p className="text-sm font-semibold">Two-Factor Verification</p></div>
              <p className="text-xs text-slate-500">As {ROLES[tempUser?.role]?.label}, your account requires 2FA. Demo code: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">123456</code></p>
              <input value={twoFA} onChange={e => setTwoFA(e.target.value)} maxLength={6} placeholder="6-digit code" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono text-center tracking-widest text-lg" autoFocus />
              <button onClick={verify2FA} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium">Verify</button>
              <button onClick={() => { setNeed2FA(false); setTempUser(null); setTwoFA(''); }} className="w-full text-xs text-slate-500">Cancel</button>
            </div>
          )}

          {/* ─── FIRST-TIME SETUP ─── */}
          {!need2FA && isFirstTime && (
            <div className="space-y-3">
              <div className="text-center mb-3">
                <div className="inline-flex w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-100 to-blue-100 items-center justify-center mb-2"><Sparkles className="w-6 h-6 text-blue-600" /></div>
                <h2 className="text-lg font-bold">Welcome to ImageVault! 🎉</h2>
                <p className="text-xs text-slate-500">Let's set up your bakery</p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Bakery / Business Name</label>
                <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="Brinda Sweets Baker's Lounge" autoFocus className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Your Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Bharat Sharma" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Mail className="w-3 h-3" /> Your Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourbakery.com" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Password</label>
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Confirm Password</label>
                <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Type again" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} className="w-3.5 h-3.5" />
                Show password
              </label>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-[11px] text-blue-800">
                💡 You'll be the <b>👑 Admin</b> with full access. You can invite Managers and Operators later.
              </div>

              <button onClick={setupAdmin} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-200">
                <Sparkles className="w-4 h-4" /> Create Bakery & Admin Account
              </button>
            </div>
          )}

          {/* ─── SIGN-IN OR REDEEM INVITE (returning users) ─── */}
          {!need2FA && !isFirstTime && (
            <>
              <div className="flex gap-2 mb-5 bg-slate-100 p-1 rounded-lg">
                <button onClick={() => setMode('login')} className={`flex-1 py-2 px-3 rounded-md text-sm font-medium ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Sign In</button>
                <button onClick={() => setMode('invite')} className={`flex-1 py-2 px-3 rounded-md text-sm font-medium ${mode === 'invite' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Have Invite Code</button>
              </div>

              {mode === 'login' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Mail className="w-3 h-3" /> Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourbakery.com" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" autoFocus />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Password</label>
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} placeholder="Your password" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} className="w-3.5 h-3.5" />
                    Show password
                  </label>
                  <button onClick={login} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-2.5 rounded-lg font-medium">Sign In</button>
                </div>
              )}

              {mode === 'invite' && (
                <div className="space-y-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-[11px] text-emerald-800">
                    📨 Got an invite code from your admin? Enter it here to create your account.
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Your Name</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Mail className="w-3 h-3" /> Email <span className="text-slate-400 font-normal">(must match invite)</span></label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Key className="w-3 h-3" /> Invite Code</label>
                    <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="INVAB12C or MGRXYZ45" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Set Password</label>
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Confirm Password</label>
                    <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Type again" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} className="w-3.5 h-3.5" />
                    Show password
                  </label>
                  <button onClick={redeemInvite} className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 text-white py-2.5 rounded-lg font-medium">Create Account</button>
                </div>
              )}
            </>
          )}

        </div>

        <p className="text-center text-[10px] text-slate-400 mt-4">{data.settings?.brandName ? `${data.settings.brandName} · ` : ''}Powered by ImageVault Pro</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════════════════
function Header() {
  const { data, session, persistData } = useApp();
  const r = ROLES[session.role] || ROLES.operator;
  const [showNotifs, setShowNotifs] = useState(false);
  const unread = (data.notifications || []).filter(n => !n.read).length;

  const openSearch = () => {
    const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true });
    window.dispatchEvent(e);
  };

  const markAllRead = async () => {
    await persistData({ ...data, notifications: (data.notifications || []).map(n => ({ ...n, read: true })) });
  };

  return (
    <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center"><ImageIcon className="w-4 h-4 text-white" /></div>
          <div><h1 className="text-sm font-bold leading-tight dark:text-white">ImageVault <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">PRO</span></h1><p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">Bakery Inventory</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openSearch} className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 transition" title="Search (⌘K)"><Search className="w-4 h-4 text-slate-600 dark:text-slate-300" /></button>
          <button onClick={() => setShowNotifs(true)} className="relative w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 transition" title="Notifications">
            <AlertCircle className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>}
          </button>
          <div className="text-right">
            <p className="text-xs font-medium leading-tight dark:text-white">{session.name}</p>
            <p className="text-[10px] leading-tight flex items-center gap-1 justify-end"><span>{r.icon}</span><span className="text-slate-500 dark:text-slate-400 uppercase tracking-wide">{r.label}</span></p>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold flex items-center justify-center text-xs">{session.name[0]}</div>
        </div>
      </div>
      {showNotifs && <NotificationCenter onClose={() => setShowNotifs(false)} onMarkAllRead={markAllRead} />}
    </header>
  );
}

function NotificationCenter({ onClose, onMarkAllRead }) {
  const { data, persistData, showToast } = useApp();
  const notifs = data.notifications || [];
  const TYPE_STYLES = {
    season: { bg: 'bg-amber-50 dark:bg-amber-900/30', border: 'border-amber-200 dark:border-amber-800', icon: '🎉', text: 'text-amber-900 dark:text-amber-200' },
    inventory: { bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-800', icon: '📦', text: 'text-blue-900 dark:text-blue-200' },
    insight: { bg: 'bg-purple-50 dark:bg-purple-900/30', border: 'border-purple-200 dark:border-purple-800', icon: '💡', text: 'text-purple-900 dark:text-purple-200' },
    customer: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-200 dark:border-emerald-800', icon: '👤', text: 'text-emerald-900 dark:text-emerald-200' },
    admin: { bg: 'bg-slate-50 dark:bg-slate-700', border: 'border-slate-200 dark:border-slate-600', icon: '⚙️', text: 'text-slate-900 dark:text-slate-200' },
  };

  const dismiss = async (id) => {
    await persistData({ ...data, notifications: notifs.filter(n => n.id !== id) });
  };

  const dismissAll = async () => {
    if (!confirm('Clear all notifications?')) return;
    await persistData({ ...data, notifications: [] });
    showToast('All cleared');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[80] flex items-start justify-end p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold dark:text-white">Notifications</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{notifs.length} total · {notifs.filter(n => !n.read).length} unread</p>
          </div>
          <div className="flex gap-1">
            {notifs.length > 0 && <button onClick={onMarkAllRead} className="text-xs text-blue-600 px-2 py-1">Mark all read</button>}
            <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {notifs.length === 0 ? (
            <div className="text-center py-10">
              <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">All caught up! 🎉</p>
              <p className="text-xs text-slate-400 mt-1">Smart triggers will notify you of low inventory, hot picks, and seasonal opportunities.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifs.map(n => {
                const s = TYPE_STYLES[n.type] || TYPE_STYLES.admin;
                return (
                  <div key={n.id} className={`${s.bg} ${s.border} border rounded-xl p-3 relative ${!n.read ? 'shadow-md' : 'opacity-70'}`}>
                    {!n.read && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500"></span>}
                    <div className="flex items-start gap-2">
                      <span className="text-xl">{s.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${s.text}`}>{n.title}</p>
                        <p className={`text-xs mt-0.5 ${s.text} opacity-90`}>{n.body}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{utils.ago(n.ts)}</p>
                      </div>
                      <button onClick={() => dismiss(n.id)} className="text-slate-400 hover:text-red-500 p-0.5"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {notifs.length > 0 && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-700">
            <button onClick={dismissAll} className="w-full text-xs text-red-500 py-2">Clear All</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME TAB
// ═══════════════════════════════════════════════════════════════════════════
function HomeTab({ setActiveTab }) {
  const { data, session, t } = useApp();
  const stats = useMemo(() => ({
    images: data.images.length,
    cats: data.categories.length,
    subs: data.categories.reduce((a, c) => a + c.subcategories.length, 0),
    shares: (data.shareLog || []).length,
  }), [data]);

  const hotPicks = useMemo(() => {
    const counts = {};
    (data.shareLog || []).forEach(s => { counts[s.imageId] = (counts[s.imageId] || 0) + 1; });
    return data.images.map(i => ({ ...i, shares: counts[i.id] || 0 })).filter(i => i.shares > 0).sort((a, b) => b.shares - a.shares).slice(0, 6);
  }, [data]);

  const seasonal = useMemo(() => {
    const m = new Date().getMonth();
    const events = [{ months: [9, 10], name: 'Diwali', kw: 'diwali' }, { months: [1, 2], name: 'Wedding Season', kw: 'wedding' }, { months: [11], name: 'Christmas', kw: 'christmas' }];
    const u = events.find(e => e.months.includes(m) || e.months.includes((m + 1) % 12));
    if (!u) return null;
    const last = (data.shareLog || []).filter(s => { const i = data.images.find(x => x.id === s.imageId); return i && i.keywords.some(k => k.includes(u.kw)); }).length;
    return { ...u, lastShares: last };
  }, [data]);

  return (
    <div className="p-4 space-y-4">
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-2xl p-5 text-white shadow-lg shadow-blue-200/50">
        <p className="text-blue-100 text-xs font-medium uppercase tracking-wider">{t.welcome}</p>
        <h2 className="text-2xl font-bold mt-1">{session.name} 👋</h2>
        <p className="text-blue-100 text-sm mt-2">Your bakery's visual catalog at your fingertips.</p>
      </div>

      {seasonal && (
        <button onClick={() => setActiveTab('search')} className="w-full bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3 text-left">
          <div className="w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-white" /></div>
          <div className="flex-1"><p className="text-sm font-semibold text-amber-900">{seasonal.name} approaching!</p><p className="text-[11px] text-amber-700">Last year: {seasonal.lastShares} {seasonal.kw}-tagged shares</p></div>
          <ChevronRight className="w-4 h-4 text-amber-700" />
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { l: t.images, v: stats.images, i: ImageIcon, c: 'from-blue-500 to-blue-600' },
          { l: t.categories, v: stats.cats, i: Folder, c: 'from-emerald-500 to-emerald-600' },
          { l: t.subcategories, v: stats.subs, i: FolderTree, c: 'from-amber-500 to-orange-500' },
          { l: 'Shares', v: stats.shares, i: Share2, c: 'from-purple-500 to-pink-500' },
        ].map(s => (
          <div key={s.l} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
            <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${s.c} flex items-center justify-center mb-2`}><s.i className="w-4 h-4 text-white" /></div>
            <p className="text-2xl font-bold">{s.v}</p>
            <p className="text-xs text-slate-500">{s.l}</p>
          </div>
        ))}
      </div>

      {hotPicks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1 flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-500" /> Hot Picks</h3>
          <div className="grid grid-cols-3 gap-2">
            {hotPicks.map(img => (
              <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden">
                <LazyImage id={img.id} thumbnail={img.thumbnail} className="w-full h-full" />
                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-full">{img.shares}×</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1 dark:text-slate-400">Quick Actions</h3>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
          {[
            { l: t.search, i: Search, tab: 'search', d: 'Find by keyword' },
            { l: 'Bulk Upload', i: Upload, tab: 'upload', d: 'Add multiple' },
            { l: 'Festive Campaigns', i: Sparkles, tab: 'campaigns', d: 'Diwali, Wedding & more' },
            { l: t.collections, i: Layers, tab: 'collections', d: 'Curate lookbooks' },
          ].map(a => (
            <button key={a.l} onClick={() => setActiveTab(a.tab)} className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-700 text-left">
              <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center"><a.i className="w-4 h-4 text-slate-700 dark:text-slate-300" /></div>
              <div className="flex-1"><p className="text-sm font-medium dark:text-white">{a.l}</p><p className="text-xs text-slate-500 dark:text-slate-400">{a.d}</p></div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          ))}
        </div>
      </div>

      {(data.activityLog || []).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1 dark:text-slate-400 flex items-center gap-1.5"><Clock className="w-3 h-3" /> Recent Activity</h3>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm p-3">
            <ActivityFeed limit={6} compact />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE CARD (paginated, lazy)
// ═══════════════════════════════════════════════════════════════════════════
function ImageCard({ img, onClick, selected, selectMode }) {
  const { data } = useApp();
  const isFav = (data.favorites || []).includes(img.id);
  const isPin = (data.pinned || []).includes(img.id);
  return (
    <button onClick={onClick} className={`relative bg-white rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition text-left ${selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-slate-100'}`}>
      <div className="aspect-square relative">
        <LazyImage id={img.id} thumbnail={img.thumbnail} alt={img.name} className="w-full h-full" />
        {selectMode && <div className={`absolute top-2 left-2 w-6 h-6 rounded-md border-2 flex items-center justify-center z-10 ${selected ? 'bg-blue-600 border-blue-600' : 'bg-white/80 border-white'}`}>{selected && <Check className="w-4 h-4 text-white" />}</div>}
        {!selectMode && isFav && <Star className="absolute top-2 right-2 w-4 h-4 text-amber-400 fill-amber-400 drop-shadow z-10" />}
        {!selectMode && isPin && <Pin className="absolute top-2 left-2 w-4 h-4 text-blue-500 fill-blue-500 drop-shadow z-10" />}
      </div>
      <div className="p-2.5">
        <p className="text-xs font-medium text-slate-900 truncate">{img.name}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {img.keywords.slice(0, 2).map(k => <span key={k} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{k}</span>)}
          {img.keywords.length > 2 && <span className="text-[10px] text-slate-400">+{img.keywords.length - 2}</span>}
        </div>
      </div>
    </button>
  );
}

// Paginated image grid with "Load more"
function PaginatedGrid({ images, onSelect, selectMode, selectedIds, onToggleSel }) {
  const [shown, setShown] = useState(CFG.PAGE_SIZE);
  const visible = images.slice(0, shown);
  const hasMore = shown < images.length;

  if (images.length === 0) {
    return <div className="bg-white rounded-xl border border-dashed border-slate-200 p-10 text-center">
      <ImageIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
      <p className="text-sm text-slate-500">No images</p>
    </div>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {visible.map(img => (
          <ImageCard key={img.id} img={img} onClick={() => selectMode ? onToggleSel(img.id) : onSelect(img)} selected={selectedIds?.has(img.id)} selectMode={selectMode} />
        ))}
      </div>
      {hasMore && (
        <button onClick={() => setShown(s => s + CFG.PAGE_SIZE)} className="w-full mt-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-blue-600 hover:bg-blue-50">
          Load more ({images.length - shown} remaining)
        </button>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH TAB
// ═══════════════════════════════════════════════════════════════════════════
function SearchTab() {
  const { data, persistData, showToast, t } = useApp();
  const [query, setQuery] = useState('');
  const [logic, setLogic] = useState('OR');
  const [filters, setFilters] = useState({ categoryId: '', subcategoryId: '', dateFrom: '', dateTo: '', uploader: '' });
  const [sortBy, setSortBy] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedSub, setSelectedSub] = useState(null);
  const [showSave, setShowSave] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [browseMode, setBrowseMode] = useState(false);
  const [expanded, setExpanded] = useState({});

  const matched = useMemo(() => {
    let imgs = [...data.images];
    if (filters.categoryId) imgs = imgs.filter(i => i.categoryId === filters.categoryId);
    if (filters.subcategoryId) imgs = imgs.filter(i => i.subcategoryId === filters.subcategoryId);
    if (filters.uploader) imgs = imgs.filter(i => i.uploadedBy === filters.uploader);
    if (filters.dateFrom) imgs = imgs.filter(i => i.uploadedAt >= new Date(filters.dateFrom).getTime());
    if (filters.dateTo) imgs = imgs.filter(i => i.uploadedAt <= new Date(filters.dateTo).getTime() + 86400000);

    const q = query.toLowerCase().trim();
    if (q) {
      const tokens = q.split(/\s+(?:and|&)\s+/i).join(' ').split(/\s+/).filter(Boolean);
      imgs = imgs.filter(img => {
        const hay = [img.name, ...img.keywords].join(' ').toLowerCase();
        return logic === 'AND' ? tokens.every(t => hay.includes(t)) : tokens.some(t => hay.includes(t));
      });
    }
    const counts = {};
    (data.shareLog || []).forEach(s => { counts[s.imageId] = (counts[s.imageId] || 0) + 1; });
    if (sortBy === 'newest') imgs.sort((a, b) => b.uploadedAt - a.uploadedAt);
    else if (sortBy === 'alpha') imgs.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'shares') imgs.sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
    else if (sortBy === 'tags') imgs.sort((a, b) => b.keywords.length - a.keywords.length);
    return imgs;
  }, [data.images, data.shareLog, query, logic, filters, sortBy]);

  const grouped = useMemo(() => {
    const g = {};
    matched.forEach(img => {
      if (!g[img.subcategoryId]) {
        const sub = data.categories.flatMap(c => c.subcategories).find(s => s.id === img.subcategoryId);
        const cat = data.categories.find(c => c.subcategories.some(s => s.id === img.subcategoryId));
        if (sub && cat) g[img.subcategoryId] = { sub, cat, count: 0 };
      }
      if (g[img.subcategoryId]) g[img.subcategoryId].count++;
    });
    return Object.values(g);
  }, [matched, data.categories]);

  const saveFolder = async () => {
    if (!folderName.trim()) return showToast('Enter name', 'error');
    await persistData({ ...data, smartFolders: [...(data.smartFolders || []), { id: utils.uid('sf'), name: folderName.trim(), query, logic, filters, sortBy }] });
    showToast('Saved'); setShowSave(false); setFolderName('');
  };

  if (selectedSub) {
    const sub = data.categories.flatMap(c => c.subcategories).find(s => s.id === selectedSub);
    const cat = data.categories.find(c => c.subcategories.some(s => s.id === selectedSub));
    const subImgs = matched.filter(i => i.subcategoryId === selectedSub);
    return <ImageGridScreen title={sub.name} subtitle={`${cat.icon} ${cat.name}`} images={subImgs} onBack={() => setSelectedSub(null)} />;
  }

  const cat = data.categories.find(c => c.id === filters.categoryId);
  const uploaders = Array.from(new Set(data.images.map(i => i.uploadedBy)));
  const hasFilters = query || filters.categoryId || filters.uploader || filters.dateFrom;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold">Search & Browse</h2><p className="text-xs text-slate-500">Smart partial-match · AND/OR · filters</p></div>
        <button onClick={() => setBrowseMode(!browseMode)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white">{browseMode ? 'Search' : 'Browse'}</button>
      </div>

      {browseMode ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm divide-y divide-slate-100 overflow-hidden">
          {data.categories.map(c => {
            const open = expanded[c.id];
            const cnt = data.images.filter(i => c.subcategories.some(s => s.id === i.subcategoryId)).length;
            return (
              <div key={c.id}>
                <button onClick={() => setExpanded(p => ({ ...p, [c.id]: !p[c.id] }))} className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 text-left">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl">{c.icon}</div>
                  <div className="flex-1"><p className="text-sm font-semibold">{c.name}</p><p className="text-[11px] text-slate-500">{c.subcategories.length} subs · {cnt} images</p></div>
                  {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </button>
                {open && <div className="bg-slate-50/50 border-t border-slate-100">
                  {c.subcategories.map(s => {
                    const sc = data.images.filter(i => i.subcategoryId === s.id).length;
                    return <button key={s.id} onClick={() => setSelectedSub(s.id)} className="w-full flex items-center gap-3 pl-6 pr-3.5 py-3 hover:bg-white border-b border-slate-100 last:border-b-0 text-left">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                      <span className="flex-1 text-sm text-slate-700">{s.name}</span>
                      <span className="text-[11px] text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">{sc}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    </button>;
                  })}
                </div>}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="chocolate AND wedding · diwali..." className="w-full pl-10 pr-20 py-3 rounded-xl bg-white border border-slate-200 text-sm shadow-sm" autoFocus />
            <button onClick={() => setLogic(logic === 'AND' ? 'OR' : 'AND')} className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold px-2 py-1 rounded ${logic === 'AND' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{logic}</button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border whitespace-nowrap ${showFilters || hasFilters ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'}`}><Filter className="w-3 h-3" /> Filters{hasFilters && ' •'}</button>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 bg-white whitespace-nowrap">
              <option value="newest">Newest</option><option value="alpha">A–Z</option><option value="shares">Most shared</option><option value="tags">Most tagged</option>
            </select>
            {hasFilters && <button onClick={() => setShowSave(true)} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 whitespace-nowrap"><Star className="w-3 h-3" /> Save</button>}
          </div>

          {showFilters && (
            <div className="bg-white rounded-xl border border-slate-100 p-3 space-y-2 shadow-sm">
              <div className="grid grid-cols-2 gap-2">
                <select value={filters.categoryId} onChange={e => setFilters({ ...filters, categoryId: e.target.value, subcategoryId: '' })} className="px-2 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                  <option value="">All categories</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select>
                <select value={filters.subcategoryId} onChange={e => setFilters({ ...filters, subcategoryId: e.target.value })} disabled={!cat} className="px-2 py-2 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50">
                  <option value="">All subs</option>{cat?.subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input type="date" value={filters.dateFrom} onChange={e => setFilters({ ...filters, dateFrom: e.target.value })} className="px-2 py-2 rounded-lg border border-slate-200 text-xs" />
                <input type="date" value={filters.dateTo} onChange={e => setFilters({ ...filters, dateTo: e.target.value })} className="px-2 py-2 rounded-lg border border-slate-200 text-xs" />
              </div>
              <select value={filters.uploader} onChange={e => setFilters({ ...filters, uploader: e.target.value })} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                <option value="">Any uploader</option>{uploaders.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <button onClick={() => setFilters({ categoryId: '', subcategoryId: '', dateFrom: '', dateTo: '', uploader: '' })} className="w-full text-xs text-slate-500 py-1">Clear</button>
            </div>
          )}

          {(data.smartFolders || []).length > 0 && !query && !hasFilters && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2 px-1">Smart Folders</p>
              <div className="flex flex-wrap gap-2">
                {data.smartFolders.map(f => (
                  <button key={f.id} onClick={() => { setQuery(f.query); setLogic(f.logic); setFilters(f.filters); setSortBy(f.sortBy); }} className="text-xs bg-white border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-full font-medium flex items-center gap-1"><Star className="w-3 h-3" /> {f.name}</button>
                ))}
              </div>
            </div>
          )}

          {!query && !hasFilters ? (
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-xs font-semibold text-slate-500 uppercase">{t.popular}</p>
                <p className="text-[10px] text-slate-400">Tap to toggle · multi-select</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from(new Set(data.images.flatMap(i => i.keywords))).slice(0, 20).map(kw => {
                  const active = query.toLowerCase().split(/[\s,]+/).filter(Boolean).includes(kw.toLowerCase());
                  return (
                    <button
                      key={kw}
                      onClick={() => {
                        const tokens = query.split(/[\s,]+/).filter(Boolean);
                        const idx = tokens.findIndex(t => t.toLowerCase() === kw.toLowerCase());
                        if (idx >= 0) tokens.splice(idx, 1);
                        else tokens.push(kw);
                        setQuery(tokens.join(' '));
                      }}
                      className={`text-xs px-3 py-1.5 rounded-full transition flex items-center gap-1 ${active ? 'bg-blue-600 text-white border border-blue-600' : 'bg-white border border-slate-200 text-slate-700 hover:bg-blue-50 hover:border-blue-300'}`}
                    >
                      {active && <Check className="w-3 h-3" />}
                      {kw}
                    </button>
                  );
                })}
                {data.images.length === 0 && <p className="text-xs text-slate-400">Upload images first</p>}
              </div>
              {query && (
                <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-2.5 flex items-center gap-2">
                  <Filter className="w-3.5 h-3.5 text-blue-600" />
                  <p className="text-xs text-blue-800 flex-1">Active query: <code className="bg-white px-1.5 py-0.5 rounded">{query}</code> · using <b>{logic}</b></p>
                  <button onClick={() => setQuery('')} className="text-blue-600"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          ) : matched.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-slate-200 p-10 text-center">
              <Search className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No matches</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{grouped.length} subcategories · {matched.length} images</p>
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm divide-y divide-slate-100 overflow-hidden">
                {grouped.map(({ sub, cat, count }) => (
                  <button key={sub.id} onClick={() => setSelectedSub(sub.id)} className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 text-left">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-lg">{cat.icon}</div>
                    <div className="flex-1 min-w-0"><p className="text-sm font-semibold">{sub.name}</p><p className="text-[11px] text-slate-500">{cat.name} · {count} images</p></div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showSave && (
        <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-4" onClick={() => setShowSave(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Save Smart Folder</h3>
            <input value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="e.g. Diwali 2026" autoFocus className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setShowSave(false)} className="flex-1 py-2.5 rounded-lg bg-slate-100 text-sm font-medium">Cancel</button>
              <button onClick={saveFolder} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE GRID SCREEN — with bulk actions
// ═══════════════════════════════════════════════════════════════════════════
function ImageGridScreen({ title, subtitle, images, onBack }) {
  const { session, showToast } = useApp();
  const [selected, setSelected] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selIds, setSelIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const canBulk = can(session, 'image.bulk');

  const toggle = id => { const n = new Set(selIds); n.has(id) ? n.delete(id) : n.add(id); setSelIds(n); };
  const all = () => setSelIds(selIds.size === images.length ? new Set() : new Set(images.map(i => i.id)));

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div className="flex items-start justify-between gap-3">
        <div>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-xs text-slate-500">{images.length} images{selectMode && selIds.size > 0 && ` · ${selIds.size} selected`}</p>
        </div>
        {images.length > 0 && canBulk && <button onClick={() => { setSelectMode(!selectMode); setSelIds(new Set()); }} className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${selectMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'}`}>{selectMode ? 'Done' : 'Select'}</button>}
      </div>

      {selectMode && selIds.size > 0 && (
        <div className="bg-blue-600 text-white rounded-xl p-3 flex items-center gap-2 sticky top-16 z-20 shadow-lg">
          <button onClick={all} className="text-xs underline">{selIds.size === images.length ? 'Deselect all' : 'Select all'}</button>
          <span className="text-xs flex-1 text-center">{selIds.size} selected</span>
          <button onClick={() => setBulkAction('tag')} className="bg-white/20 px-3 py-1.5 rounded-lg text-xs font-medium"><Tag className="w-3.5 h-3.5 inline" /></button>
          <button onClick={() => setBulkAction('share')} className="bg-white/20 px-3 py-1.5 rounded-lg text-xs font-medium"><Share2 className="w-3.5 h-3.5 inline" /></button>
          {can(session, 'image.delete') && <button onClick={() => setBulkAction('delete')} className="bg-red-500 px-3 py-1.5 rounded-lg text-xs font-medium"><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
      )}

      <PaginatedGrid images={images} onSelect={setSelected} selectMode={selectMode} selectedIds={selIds} onToggleSel={toggle} />

      {selected && <ImagePreview img={selected} onClose={() => setSelected(null)} />}
      {bulkAction && <BulkActionModal action={bulkAction} ids={selIds} images={images.filter(i => selIds.has(i.id))} onClose={() => { setBulkAction(null); setSelIds(new Set()); setSelectMode(false); }} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BULK ACTION MODAL
// ═══════════════════════════════════════════════════════════════════════════
function BulkActionModal({ action, ids, images, onClose }) {
  const { data, persistData, session, showToast, logActivity } = useApp();
  const [kw, setKw] = useState('');
  const [phone, setPhone] = useState('');
  const [template, setTemplate] = useState('');
  const brand = data.settings?.brandName || 'Brinda Sweets Baker\'s Lounge';

  const TEMPLATES = [
    { l: 'Diwali', t: `🪔 *Diwali Special* — Tap to order!\n\n— ${brand}` },
    { l: 'Wedding', t: `💍 *Wedding Showcase* — Premium picks for your big day\n\n— ${brand}` },
    { l: 'Festive', t: `🎉 Sweet celebrations from our kitchen to yours\n\n— ${brand}` },
    { l: 'Corporate', t: `🎁 *Corporate Gifting* — Bulk discounts available\n\n— ${brand}` },
  ];

  const apply = async () => {
    if (action === 'tag') {
      const tags = kw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!tags.length) return showToast('Add keywords', 'error');
      const updated = data.images.map(i => ids.has(i.id) ? { ...i, keywords: Array.from(new Set([...i.keywords, ...tags])) } : i);
      await persistData({ ...data, images: updated });
      logActivity('bulk_tag', `${ids.size} imgs`);
      showToast(`Tagged ${ids.size}`); onClose();
    } else if (action === 'delete') {
      if (!confirm(`Delete ${ids.size} images?`)) return;
      // Delete from imageRepo too
      for (const id of ids) await imageRepo.remove(id);
      await persistData({ ...data, images: data.images.filter(i => !ids.has(i.id)) });
      logActivity('bulk_delete', `${ids.size}`);
      showToast(`Deleted ${ids.size}`); onClose();
    } else if (action === 'share') {
      const tpl = TEMPLATES.find(x => x.l === template)?.t || `Check out our catalog!\n\n— ${brand}`;
      const list = images.map(i => `• ${i.name}`).join('\n');
      const msg = `${tpl}\n\n*Items:*\n${list}\n\nReply for details!`;
      const ph = phone.replace(/\D/g, '');
      const url = ph ? `https://wa.me/${ph}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
      const newLogs = images.map(i => ({ id: utils.uid('s'), imageId: i.id, ts: Date.now(), user: session.email }));
      await persistData({ ...data, shareLog: [...(data.shareLog || []), ...newLogs] });
      logActivity('bulk_share', `${ids.size}`);
      showToast('Opening WhatsApp...'); onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{action === 'tag' ? 'Bulk Tag' : action === 'delete' ? 'Bulk Delete' : 'Bulk Share'}</h3>
        <p className="text-xs text-slate-500">Affecting {ids.size} images</p>
        {action === 'tag' && <div><input value={kw} onChange={e => setKw(e.target.value)} placeholder="diwali2026, premium" autoFocus className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" /><p className="text-[10px] text-slate-400 mt-1">Comma-separated</p></div>}
        {action === 'share' && <>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210 (optional)" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
          <select value={template} onChange={e => setTemplate(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="">Default message</option>{TEMPLATES.map(t => <option key={t.l} value={t.l}>{t.l}</option>)}
          </select>
        </>}
        {action === 'delete' && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">⚠️ Cannot be undone</div>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-slate-100 text-sm font-medium">Cancel</button>
          <button onClick={apply} className={`flex-1 py-2.5 rounded-lg text-white text-sm font-medium ${action === 'delete' ? 'bg-red-600' : 'bg-blue-600'}`}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UPLOAD TAB
// ═══════════════════════════════════════════════════════════════════════════
function UploadTab() {
  const { data, persistData, session, showToast, logActivity } = useApp();
  const [stage, setStage] = useState('drop');
  const [pending, setPending] = useState([]);
  const [aiBusy, setAiBusy] = useState({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const camRef = useRef(null);

  const onFiles = async (fileList) => {
    const files = Array.from(fileList).slice(0, 10); // limit 10 at a time for stability
    if (files.length === 0) return;
    showToast(`Processing ${files.length} image${files.length > 1 ? 's' : ''}...`);
    const out = [];
    for (const file of files) {
      if (file.size > CFG.MAX_IMG_SIZE) { showToast(`${file.name} > 10MB skipped`, 'error'); continue; }
      try {
        const { full, thumb } = await utils.process(file);
        const hash = await utils.hash(thumb);
        const dup = data.images.find(i => utils.hamming(i.hash || '', hash) < 5);
        const colors = await utils.colors(thumb);
        out.push({
          tempId: utils.uid('tmp'),
          name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          size: file.size, full, thumb, hash, colors,
          duplicate: dup ? dup.name : null,
          categoryId: '', subcategoryId: '', keywords: [],
        });
      } catch { showToast(`Failed ${file.name}`, 'error'); }
    }
    if (out.length > 0) { setPending(out); setStage('review'); showToast(`${out.length} ready to review`); }
  };

  const update = (tid, u) => setPending(p => p.map(x => x.tempId === tid ? { ...x, ...u } : x));
  const remove = (tid) => { setPending(p => { const n = p.filter(x => x.tempId !== tid); if (n.length === 0) setStage('drop'); return n; }); };

  const aiSuggest = async (item) => {
    setAiBusy(p => ({ ...p, [item.tempId]: true }));
    try {
      const result = await aiVision.autoTag(item.full, { mode: 'enhanced' });
      const tags = result.tags || [];
      const structured = result.structured || {};
      if (tags.length) {
        update(item.tempId, {
          keywords: Array.from(new Set([...item.keywords, ...tags])),
          aiStructured: structured,
        });
        showToast(`✨ AI added ${tags.length} tags`);
      } else showToast('AI returned no tags', 'error');
    } catch { showToast('AI failed', 'error'); }
    setAiBusy(p => ({ ...p, [item.tempId]: false }));
  };

  const applyAll = (field, value) => setPending(p => p.map(x => ({ ...x, [field]: field === 'keywords' ? Array.from(new Set([...(x.keywords || []), ...value])) : value, ...(field === 'categoryId' ? { subcategoryId: '' } : {}) })));

  const submit = async () => {
    const valid = pending.filter(p => p.subcategoryId && p.keywords.length > 0 && p.name.trim());
    if (valid.length === 0) return showToast('Each needs name + subcategory + keywords', 'error');
    if (valid.length < pending.length && !confirm(`${valid.length}/${pending.length} ready. Upload ready ones?`)) return;
    setUploading(true);
    showToast(`Saving ${valid.length} images...`);
    try {
      const newMetas = [];
      const wmSettings = data.settings;
      const autoWM = data.settings.autoWatermark;
      const operatorForceWM = session.role === 'operator' && data.settings.autoWatermark !== false; // operators always watermark by default
      for (const p of valid) {
        const id = utils.uid('img');
        let fullToSave = p.full;
        let thumbToSave = p.thumb;
        if (autoWM || operatorForceWM) {
          fullToSave = await utils.watermark(p.full, wmSettings);
          thumbToSave = await utils.watermark(p.thumb, wmSettings);
        }
        await imageRepo.putFull(id, fullToSave);
        newMetas.push({
          id, name: p.name.trim(),
          categoryId: p.categoryId, subcategoryId: p.subcategoryId,
          keywords: p.keywords, thumbnail: thumbToSave,
          hash: p.hash, colors: p.colors || [],
          uploadedBy: session.email, uploadedAt: Date.now(),
          watermarked: autoWM || operatorForceWM,
        });
      }
      await persistData({ ...data, images: [...data.images, ...newMetas] });
      logActivity('upload', `${newMetas.length}`);
      showToast(`✓ ${newMetas.length} images saved`);
      setPending([]); setStage('drop');
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
    }
    setUploading(false);
  };

  if (stage === 'review') {
    return <ReviewStage pending={pending} update={update} remove={remove} aiSuggest={aiSuggest} aiBusy={aiBusy} applyAll={applyAll} submit={submit} uploading={uploading} cancel={() => { setPending([]); setStage('drop'); }} />;
  }

  return (
    <div className="p-4 space-y-4">
      <div><h2 className="text-xl font-bold">Bulk Upload</h2><p className="text-xs text-slate-500">Up to 10 at once · 10MB max each · AI auto-tag · Duplicate check</p></div>
      <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-8" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
        <div className="text-center">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-blue-50 items-center justify-center mb-3"><Upload className="w-6 h-6 text-blue-600" /></div>
          <p className="text-sm font-semibold">Drop images or browse</p>
          <p className="text-xs text-slate-500 mt-1">Multiple files supported</p>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button onClick={() => fileRef.current?.click()} className="bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2"><Upload className="w-4 h-4" /> Browse</button>
            <button onClick={() => camRef.current?.click()} className="bg-slate-100 text-slate-700 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2"><Camera className="w-4 h-4" /> Camera</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => { onFiles(e.target.files); e.target.value = ''; }} className="hidden" />
          <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={e => { onFiles(e.target.files); e.target.value = ''; }} className="hidden" />
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-100 p-3 space-y-1.5">
        <p className="text-xs font-semibold flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-purple-500" /> AI-Powered Features</p>
        <p className="text-[11px] text-slate-500">• Auto-tag with Claude Vision</p>
        <p className="text-[11px] text-slate-500">• Duplicate detection (perceptual hash)</p>
        <p className="text-[11px] text-slate-500">• Color palette extraction</p>
        <p className="text-[11px] text-slate-500">• Smart compression (full + thumbnail)</p>
      </div>
    </div>
  );
}

function ReviewStage({ pending, update, remove, aiSuggest, aiBusy, applyAll, submit, uploading, cancel }) {
  const { data, showToast } = useApp();
  const [showAll, setShowAll] = useState(false);
  const [bulkCat, setBulkCat] = useState('');
  const [bulkSub, setBulkSub] = useState('');
  const [bulkKw, setBulkKw] = useState('');
  const [editing, setEditing] = useState(null);
  const cat = data.categories.find(c => c.id === bulkCat);
  const dups = pending.filter(p => p.duplicate);

  return (
    <div className="p-4 space-y-3 pb-32">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold">Review & Tag</h2><p className="text-xs text-slate-500">{pending.length} pending{dups.length > 0 && <span className="text-amber-600"> · {dups.length} duplicates</span>}</p></div>
        <button onClick={cancel} disabled={uploading} className="text-xs text-slate-500 disabled:opacity-50">Cancel</button>
      </div>

      <button onClick={() => setShowAll(!showAll)} className="w-full bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center gap-3 text-left">
        <Wand2 className="w-5 h-5 text-purple-600" />
        <div className="flex-1"><p className="text-sm font-semibold text-purple-900">Apply to all {pending.length}</p><p className="text-[11px] text-purple-700">Set category & keywords once</p></div>
        {showAll ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {showAll && (
        <div className="bg-white rounded-xl border border-slate-100 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={bulkCat} onChange={e => { setBulkCat(e.target.value); setBulkSub(''); }} className="px-2 py-2 rounded-lg border border-slate-200 text-xs bg-white">
              <option value="">Category</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
            <select value={bulkSub} onChange={e => setBulkSub(e.target.value)} disabled={!cat} className="px-2 py-2 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50">
              <option value="">Subcategory</option>{cat?.subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <input value={bulkKw} onChange={e => setBulkKw(e.target.value)} placeholder="Keywords (comma-separated)" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs" />
          <button onClick={() => {
            if (bulkCat) applyAll('categoryId', bulkCat);
            if (bulkSub) applyAll('subcategoryId', bulkSub);
            if (bulkKw) applyAll('keywords', bulkKw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
            showToast('Applied'); setShowAll(false); setBulkCat(''); setBulkSub(''); setBulkKw('');
          }} className="w-full bg-purple-600 text-white py-2 rounded-lg text-xs font-medium">Apply to all</button>
        </div>
      )}

      <div className="space-y-2">
        {pending.map(p => <PendingItem key={p.tempId} item={p} update={update} remove={remove} aiSuggest={aiSuggest} aiBusy={aiBusy[p.tempId]} onEdit={() => setEditing(p.tempId)} />)}
      </div>

      <div className="fixed bottom-20 left-0 right-0 p-3 bg-white border-t border-slate-200 z-20">
        <button onClick={submit} disabled={uploading} className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
          {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : `Upload ${pending.length} Image${pending.length !== 1 ? 's' : ''}`}
        </button>
      </div>

      {editing && <ImageEditor item={pending.find(p => p.tempId === editing)} onSave={(d) => { update(editing, { full: d, thumb: d }); setEditing(null); }} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PendingItem({ item, update, remove, aiSuggest, aiBusy, onEdit }) {
  const { data } = useApp();
  const cat = data.categories.find(c => c.id === item.categoryId);
  const [kwI, setKwI] = useState('');
  const addKw = () => { const k = kwI.trim().toLowerCase(); if (k && !item.keywords.includes(k)) { update(item.tempId, { keywords: [...item.keywords, k] }); setKwI(''); } };

  return (
    <div className={`bg-white rounded-xl border p-3 ${item.duplicate ? 'border-amber-300' : 'border-slate-100'}`}>
      <div className="flex gap-3">
        <div className="relative">
          <img src={item.thumb} alt="" className="w-20 h-20 rounded-lg object-cover" />
          <button onClick={onEdit} className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow"><Edit3 className="w-3 h-3" /></button>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <input value={item.name} onChange={e => update(item.tempId, { name: e.target.value })} className="flex-1 px-2 py-1 rounded border border-slate-200 text-xs font-semibold" />
            <button onClick={() => remove(item.tempId)} className="text-red-500"><X className="w-4 h-4" /></button>
          </div>
          {item.duplicate && <p className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded inline-block">⚠️ Duplicate of "{item.duplicate}"</p>}
          <div className="flex gap-1.5 items-center">
            {(item.colors || []).slice(0, 4).map((c, i) => <div key={i} className="w-4 h-4 rounded border border-white shadow-sm" style={{ background: c }} />)}
            <span className="text-[10px] text-slate-400">{utils.bytes(item.size)}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <select value={item.categoryId} onChange={e => update(item.tempId, { categoryId: e.target.value, subcategoryId: '' })} className="px-2 py-1.5 rounded border border-slate-200 text-xs bg-white">
          <option value="">Category</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <select value={item.subcategoryId} onChange={e => update(item.tempId, { subcategoryId: e.target.value })} disabled={!cat} className="px-2 py-1.5 rounded border border-slate-200 text-xs bg-white disabled:bg-slate-50">
          <option value="">Subcategory</option>{cat?.subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="mt-2 flex gap-1">
        <input value={kwI} onChange={e => setKwI(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKw())} placeholder="Add keyword..." className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-xs" />
        <button onClick={() => aiSuggest(item)} disabled={aiBusy} className="px-2.5 py-1.5 rounded bg-purple-100 text-purple-700 text-xs font-medium flex items-center gap-1 disabled:opacity-50">
          {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Sparkles className="w-3 h-3" /> AI</>}
        </button>
      </div>
      {item.keywords.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">
        {item.keywords.map(k => <span key={k} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">{k}<button onClick={() => update(item.tempId, { keywords: item.keywords.filter(x => x !== k) })}><X className="w-2.5 h-2.5" /></button></span>)}
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE EDITOR
// ═══════════════════════════════════════════════════════════════════════════
function ImageEditor({ item, onSave, onClose }) {
  const { data } = useApp();
  const [rotate, setRotate] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [watermark, setWatermark] = useState(false);
  const [preview, setPreview] = useState(item.full);

  useEffect(() => {
    let cancel = false;
    (async () => {
      let r = await utils.edits(item.full, { rotate, brightness });
      if (watermark) r = await utils.watermark(r, data.settings);
      if (!cancel) setPreview(r);
    })();
    return () => { cancel = true; };
  }, [rotate, brightness, watermark]);

  return (
    <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Image Editor</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-500" /></button></div>
          <div className="rounded-lg overflow-hidden bg-slate-100 aspect-square"><img src={preview} className="w-full h-full object-contain" /></div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><label className="text-xs flex items-center gap-1"><RotateCw className="w-3 h-3" /> Rotate</label><button onClick={() => setRotate((rotate + 90) % 360)} className="text-xs bg-slate-100 px-3 py-1 rounded">{rotate}°</button></div>
            <div><label className="text-xs flex items-center gap-1"><Sun className="w-3 h-3" /> Brightness ({brightness}%)</label><input type="range" min="50" max="150" value={brightness} onChange={e => setBrightness(+e.target.value)} className="w-full" /></div>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={watermark} onChange={e => setWatermark(e.target.checked)} className="w-4 h-4" /><span className="text-xs flex items-center gap-1"><Droplet className="w-3 h-3" /> Watermark: <code className="bg-slate-100 px-1 rounded">{data.settings.watermarkText}</code></span></label>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-slate-100 text-sm font-medium">Cancel</button>
            <button onClick={() => onSave(preview)} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE PREVIEW (loads full lazily)
// ═══════════════════════════════════════════════════════════════════════════
function ImagePreview({ img, onClose }) {
  const { data, persistData, session, showToast, logActivity } = useApp();
  const [editKw, setEditKw] = useState(false);
  const [keywords, setKeywords] = useState(img.keywords);
  const [kwI, setKwI] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [fullSrc, setFullSrc] = useState(img.thumbnail);
  const [showVersions, setShowVersions] = useState(false);
  const cat = data.categories.find(c => c.id === img.categoryId);
  const sub = cat?.subcategories.find(s => s.id === img.subcategoryId);
  const isFav = (data.favorites || []).includes(img.id);
  const isPin = (data.pinned || []).includes(img.id);
  const shares = (data.shareLog || []).filter(s => s.imageId === img.id).length;
  const canEditKw = can(session, 'image.edit_any') || can(session, 'image.edit_own', img);
  const canDelete = can(session, 'image.delete');
  const versionCount = ((data.imageVersions || {})[img.id] || []).length;

  useEffect(() => {
    imageRepo.getFull(img.id).then(f => f && setFullSrc(f));
  }, [img.id]);

  const toggleFav = async () => { const list = data.favorites || []; await persistData({ ...data, favorites: isFav ? list.filter(x => x !== img.id) : [...list, img.id] }); showToast(isFav ? 'Unstarred' : 'Starred'); };
  const togglePin = async () => { const list = data.pinned || []; await persistData({ ...data, pinned: isPin ? list.filter(x => x !== img.id) : [...list, img.id] }); };
  const saveKw = async () => {
    if (!canEditKw) return showToast('You can only edit keywords on your own uploads', 'error');
    // Save version before change
    const versionEntry = {
      id: utils.uid('v'),
      name: img.name,
      keywords: img.keywords,
      ts: Date.now(),
      savedBy: session.email,
      reason: 'pre-edit snapshot',
    };
    const existingVersions = (data.imageVersions || {})[img.id] || [];
    const updatedVersions = { ...(data.imageVersions || {}), [img.id]: [versionEntry, ...existingVersions].slice(0, 10) };
    await persistData({
      ...data,
      images: data.images.map(i => i.id === img.id ? { ...i, keywords } : i),
      imageVersions: updatedVersions,
    });
    logActivity('edit_kw', img.name); setEditKw(false); showToast('Saved (with version snapshot)');
  };
  const del = async () => {
    if (!canDelete) return showToast('Permission denied — delete requires Manager or Admin', 'error');
    if (!confirm('Delete?')) return;
    await imageRepo.remove(img.id);
    await persistData({ ...data, images: data.images.filter(i => i.id !== img.id) });
    logActivity('del', img.name); showToast('Deleted'); onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="relative bg-slate-100">
          <img src={fullSrc} alt={img.name} className="w-full" />
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 shadow flex items-center justify-center"><X className="w-4 h-4" /></button>
          <div className="absolute top-3 left-3 flex gap-1.5">
            <button onClick={toggleFav} className={`w-8 h-8 rounded-full shadow flex items-center justify-center ${isFav ? 'bg-amber-400' : 'bg-white/90'}`}><Star className={`w-4 h-4 ${isFav ? 'text-white fill-white' : 'text-slate-700'}`} /></button>
            <button onClick={togglePin} className={`w-8 h-8 rounded-full shadow flex items-center justify-center ${isPin ? 'bg-blue-500' : 'bg-white/90'}`}><Pin className={`w-4 h-4 ${isPin ? 'text-white fill-white' : 'text-slate-700'}`} /></button>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <h3 className="text-lg font-bold">{img.name}</h3>
            <p className="text-xs text-slate-500">{cat?.icon} {cat?.name} · {sub?.name} · Shared {shares}×</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Uploaded by {img.uploadedBy} · {utils.ago(img.uploadedAt)}</p>
          </div>
          {(img.colors || []).length > 0 && <div className="flex items-center gap-2"><Palette className="w-3 h-3 text-slate-500" />{img.colors.map((c, i) => <div key={i} className="w-5 h-5 rounded border border-white shadow-sm" style={{ background: c }} />)}</div>}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase">Keywords</p>
              {canEditKw && <button onClick={() => setEditKw(!editKw)} className="text-xs text-blue-600 font-medium flex items-center gap-1"><Edit3 className="w-3 h-3" /> {editKw ? 'Cancel' : 'Edit'}</button>}
            </div>
            {editKw ? <div className="space-y-2">
              <div className="flex gap-2">
                <input value={kwI} onChange={e => setKwI(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), kwI.trim() && !keywords.includes(kwI.trim().toLowerCase()) && (setKeywords([...keywords, kwI.trim().toLowerCase()]), setKwI('')))} placeholder="Add" className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 text-sm" />
                <button onClick={() => { if (kwI.trim() && !keywords.includes(kwI.trim().toLowerCase())) { setKeywords([...keywords, kwI.trim().toLowerCase()]); setKwI(''); } }} className="px-3 py-2 rounded-lg bg-slate-100 text-sm">Add</button>
              </div>
              <div className="flex flex-wrap gap-1.5">{keywords.map(k => <span key={k} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">{k}<button onClick={() => setKeywords(keywords.filter(x => x !== k))}><X className="w-3 h-3" /></button></span>)}</div>
              <button onClick={saveKw} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">Save</button>
            </div> : <div className="flex flex-wrap gap-1.5">{img.keywords.map(k => <span key={k} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">{k}</span>)}</div>}
          </div>
          <div className={`grid gap-2 pt-2 ${canDelete ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button onClick={() => setShowShare(true)} className="flex items-center justify-center gap-1.5 bg-emerald-500 text-white py-2.5 rounded-lg font-medium text-xs"><Share2 className="w-3.5 h-3.5" /> Share</button>
            <button onClick={() => setShowVersions(!showVersions)} className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-medium text-xs ${showVersions ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'}`}><Clock className="w-3.5 h-3.5" /> History{versionCount > 0 && <span className="bg-white/20 text-[9px] px-1 rounded">{versionCount}</span>}</button>
            {canDelete && <button onClick={del} className="flex items-center justify-center gap-1.5 bg-red-50 text-red-600 py-2.5 rounded-lg font-medium text-xs"><Trash2 className="w-3.5 h-3.5" /> Delete</button>}
          </div>
          {showVersions && <ImageVersionsPanel img={img} onClose={() => setShowVersions(false)} />}
        </div>
      </div>
      {showShare && <ShareModal images={[img]} onClose={() => setShowShare(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARE MODAL
// ═══════════════════════════════════════════════════════════════════════════
function ShareModal({ images, onClose }) {
  const { data, persistData, session, showToast, logActivity, t } = useApp();
  const brandName = data.settings?.brandName || 'Brinda Sweets Baker\'s Lounge';
  const buildDefaultMessage = () => {
    const baseCaption = data.settings?.gupshup?.defaultCaption || "Hello! 👋 Here's the item from the catalog you asked.";
    return `${baseCaption}\n\n— *${brandName}*`;
  };
  const [mode, setMode] = useState(data.settings?.gupshup?.enabled ? 'direct' : 'manual');
  const [phone, setPhone] = useState('');
  const [pickedCustomer, setPickedCustomer] = useState(null);
  const [message, setMessage] = useState(buildDefaultMessage());
  const [downloading, setDownloading] = useState(false);
  const [imagesDownloaded, setImagesDownloaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState([]);
  const [showLink, setShowLink] = useState(false);
  const [showCustomers, setShowCustomers] = useState(false);
  const [saveCustomer, setSaveCustomer] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const linkRef = useRef(null);
  const publicLink = `https://imagevault.app/c/${session.email.split('@')[0]}/${images.map(i => i.id).join(',')}`;
  const gupshupConfig = data.settings?.gupshup || {};

  // ─── MANUAL MODE (wa.me — download then attach) ──────────────────
  const downloadAndShare = async () => {
    setDownloading(true);
    try {
      for (const img of images) {
        const full = await imageRepo.getFull(img.id) || img.thumbnail;
        if (full) {
          const safeName = img.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
          downloadDataUrl(full, `${safeName}.jpg`);
          await new Promise(r => setTimeout(r, 250));
        }
      }
      setImagesDownloaded(true);
      showToast(`✓ ${images.length} image${images.length > 1 ? 's' : ''} downloaded`);
    } catch (e) { showToast('Download failed: ' + e.message, 'error'); }
    setDownloading(false);
  };

  const openWA = async () => {
    const names = images.map(i => `• ${i.name}`).join('\n');
    const body = images.length > 1 ? `${message}\n\n*Items:*\n${names}` : `*${images[0].name}*\n\n${message}`;
    const ph = phone.replace(/\D/g, '');
    window.open(ph ? `https://wa.me/${ph}?text=${encodeURIComponent(body)}` : `https://wa.me/?text=${encodeURIComponent(body)}`, '_blank');
    const newLogs = images.map(i => ({ id: utils.uid('s'), imageId: i.id, ts: Date.now(), user: session.email, phone: ph, mode: 'manual' }));
    await persistData({ ...data, shareLog: [...(data.shareLog || []), ...newLogs] });
    logActivity('share', `${images.length} via wa.me`);
    showToast('Opening WhatsApp...');
    setTimeout(onClose, 500);
  };

  // ─── DIRECT MODE (Gupshup via Worker) ────────────────────────────
  const sendDirect = async () => {
    if (!phone.trim() || phone.replace(/\D/g, '').length < 10) return showToast('Enter valid phone number', 'error');
    if (!gupshupConfig.mockMode && !gupshupConfig.workerUrl) return showToast('Worker URL not set in Settings', 'error');

    setSending(true);
    setSendResults([]);
    const results = [];
    const newLogs = [];
    const newWaLogs = [];

    for (const img of images) {
      try {
        const full = await imageRepo.getFull(img.id) || img.thumbnail;
        const result = await whatsappAPI.send({
          phone, imageDataUrl: full, caption: `${message}${images.length > 1 ? `\n\n${img.name}` : ''}`, config: gupshupConfig,
        });
        results.push({ img, ok: true, ...result });
        newLogs.push({ id: utils.uid('s'), imageId: img.id, ts: Date.now(), user: session.email, phone: phone.replace(/\D/g, ''), mode: 'gupshup' });
        newWaLogs.push({ id: utils.uid('wa'), imageId: img.id, imageName: img.name, phone: result.sentTo, status: 'sent', mock: !!result.mock, messageId: result.messageId, mediaUrl: result.mediaUrl, ts: Date.now(), user: session.email, caption: message });
        setSendResults([...results]);
      } catch (e) {
        results.push({ img, ok: false, error: e.message });
        newWaLogs.push({ id: utils.uid('wa'), imageId: img.id, imageName: img.name, phone: phone.replace(/\D/g, ''), status: 'failed', error: e.message, ts: Date.now(), user: session.email, caption: message });
        setSendResults([...results]);
      }
    }

    // Save customer if requested
    let updatedCustomers = data.customers || [];
    if (saveCustomer && customerName.trim() && phone.trim()) {
      const cleanPhone = phone.replace(/\D/g, '');
      if (!updatedCustomers.find(c => c.phone === cleanPhone)) {
        updatedCustomers = [...updatedCustomers, { id: utils.uid('cust'), name: customerName.trim(), phone: cleanPhone, createdAt: Date.now(), addedBy: session.email }];
      }
    }

    await persistData({
      ...data,
      customers: updatedCustomers,
      shareLog: [...(data.shareLog || []), ...newLogs],
      waMessageLog: [...(data.waMessageLog || []), ...newWaLogs],
    });
    logActivity('wa_send', `${results.filter(r => r.ok).length}/${results.length} via Gupshup`);
    setSending(false);
    const okCount = results.filter(r => r.ok).length;
    if (okCount === results.length) showToast(`✓ All ${okCount} sent successfully${gupshupConfig.mockMode ? ' (mock)' : ''}`);
    else if (okCount === 0) showToast('All sends failed', 'error');
    else showToast(`${okCount}/${results.length} sent`);
  };

  const copyLink = async () => {
    const ok = await copyToClipboard(publicLink);
    if (ok) showToast('✓ Link copied!');
    else { setShowLink(true); showToast('Tap and long-press to copy', 'error'); }
  };

  const pickCustomer = (c) => { setPhone(c.phone); setPickedCustomer(c); setShowCustomers(false); };

  const customers = data.customers || [];
  const filteredCustomers = customers.slice(-20).reverse();

  return (
    <div className="fixed inset-0 bg-slate-900/80 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2"><Share2 className="w-5 h-5 text-emerald-500" /> {t.sendWA}</h3>
            <p className="text-xs text-slate-500">{images.length} image{images.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        {/* Mode tabs */}
        <div className="bg-slate-100 p-1 rounded-lg grid grid-cols-2 gap-1">
          <button onClick={() => setMode('manual')} className={`py-2 px-3 rounded-md text-xs font-medium transition ${mode === 'manual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>📱 Manual (Free)</button>
          <button onClick={() => setMode('direct')} className={`py-2 px-3 rounded-md text-xs font-medium transition flex items-center justify-center gap-1 ${mode === 'direct' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            ⚡ Direct API
            {gupshupConfig.mockMode && mode === 'direct' && <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold">MOCK</span>}
          </button>
        </div>

        {/* Phone input with customer book */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium flex items-center gap-1"><Phone className="w-3 h-3" /> {t.customerPhone}</label>
            {customers.length > 0 && <button onClick={() => setShowCustomers(!showCustomers)} className="text-[10px] text-blue-600 font-medium">📒 Phone book ({customers.length})</button>}
          </div>
          <input value={phone} onChange={e => { setPhone(e.target.value); setPickedCustomer(null); }} placeholder="+91 98765 43210" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
          {pickedCustomer && <p className="text-[10px] text-emerald-600 mt-1">✓ {pickedCustomer.name}</p>}
          {showCustomers && filteredCustomers.length > 0 && (
            <div className="mt-1 bg-slate-50 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
              {filteredCustomers.map(c => (
                <button key={c.id} onClick={() => pickCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-white border-b border-slate-200 last:border-b-0">
                  <p className="text-xs font-medium">{c.name}</p>
                  <p className="text-[10px] text-slate-500">+{c.phone}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'direct' && (
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input type="checkbox" checked={saveCustomer} onChange={e => setSaveCustomer(e.target.checked)} className="w-3.5 h-3.5" />
            Save to phone book
            {saveCustomer && <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" className="flex-1 px-2 py-1 rounded border border-slate-200 text-xs" />}
          </label>
        )}

        <div>
          <label className="text-xs font-medium mb-1 block">{t.message} / Caption</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none" />
        </div>

        {/* MANUAL MODE UI */}
        {mode === 'manual' && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-800">
              <p className="font-semibold mb-1">📌 How manual sharing works:</p>
              <p>1️⃣ Download images to phone</p>
              <p>2️⃣ Open WhatsApp with text</p>
              <p>3️⃣ Attach the downloaded images via 📎</p>
            </div>
            <div className="space-y-2">
              <button onClick={downloadAndShare} disabled={downloading || imagesDownloaded} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                {downloading ? <><Loader2 className="w-4 h-4 animate-spin" /> Downloading...</> : imagesDownloaded ? <><Check className="w-4 h-4" /> Downloaded</> : <><Download className="w-4 h-4" /> Step 1: Download</>}
              </button>
              <button onClick={openWA} className="w-full bg-emerald-500 text-white py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2"><Send className="w-4 h-4" /> Step 2: Open WhatsApp</button>
            </div>
          </>
        )}

        {/* DIRECT MODE UI */}
        {mode === 'direct' && (
          <>
            {!gupshupConfig.enabled && !gupshupConfig.mockMode && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[11px] text-red-800">
                <p className="font-semibold mb-1">⚠️ WhatsApp API not configured</p>
                <p>Go to Settings → WhatsApp API to enable Mock Mode (test) or set up Cloudflare Worker (live).</p>
              </div>
            )}
            {gupshupConfig.mockMode && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-800">
                <p className="font-semibold mb-1">🧪 Mock Mode Active</p>
                <p>No real messages will be sent. ~92% mock success rate to test error handling.</p>
              </div>
            )}
            {!gupshupConfig.mockMode && gupshupConfig.workerUrl && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-[11px] text-emerald-800">
                <p className="font-semibold">✓ Live mode — real WhatsApp messages will be sent</p>
                <p className="text-[10px] mt-0.5">Worker: {gupshupConfig.workerUrl.replace(/^https?:\/\//, '').slice(0, 40)}...</p>
              </div>
            )}
            <button
              onClick={sendDirect}
              disabled={sending || (!gupshupConfig.mockMode && !gupshupConfig.workerUrl) || !phone}
              className="w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending {sendResults.length}/{images.length}...</> : <><Zap className="w-4 h-4" /> Send {images.length} via WhatsApp API</>}
            </button>
            {sendResults.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto bg-slate-50 rounded-lg p-2">
                {sendResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-white px-2 py-1.5 rounded">
                    {r.ok ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <X className="w-3.5 h-3.5 text-red-500" />}
                    <span className="flex-1 truncate">{r.img.name}</span>
                    <span className={`text-[10px] font-medium ${r.ok ? 'text-emerald-600' : 'text-red-600'}`}>{r.ok ? (r.mock ? 'mock-sent' : 'sent') : r.error?.slice(0, 25)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="pt-2 border-t border-slate-100">
          <button onClick={copyLink} className="w-full bg-purple-50 text-purple-700 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 border border-purple-200"><Link2 className="w-4 h-4" /> {t.copyLink}</button>
          {showLink && <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-2"><p className="text-[10px] text-slate-500 mb-1">Tap and long-press to copy:</p><input ref={linkRef} value={publicLink} readOnly onClick={e => e.target.select()} className="w-full px-2 py-1.5 rounded bg-white border border-slate-200 text-xs font-mono" /></div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTIONS TAB
// ═══════════════════════════════════════════════════════════════════════════
function CollectionsTab() {
  const { data, persistData, session, showToast } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [active, setActive] = useState(null);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('');

  const create = async () => {
    if (!name.trim()) return showToast('Enter name', 'error');
    const c = { id: utils.uid('coll'), name: name.trim(), theme, imageIds: [], createdAt: Date.now(), createdBy: session.email };
    await persistData({ ...data, collections: [...(data.collections || []), c] });
    setShowCreate(false); setName(''); setTheme('');
  };

  if (active) return <CollDetail coll={active} onBack={() => setActive(null)} />;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold">Lookbooks</h2><p className="text-xs text-slate-500">Curated themed collections</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> New</button>
      </div>
      {(data.collections || []).length === 0 ? <div className="bg-white rounded-xl border border-dashed border-slate-200 p-10 text-center"><Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" /><p className="text-sm text-slate-500">No collections</p></div> : (
        <div className="grid grid-cols-2 gap-3">
          {data.collections.map(c => {
            const imgs = data.images.filter(i => c.imageIds.includes(i.id));
            return (
              <button key={c.id} onClick={() => setActive(c)} className="bg-white rounded-xl border border-slate-100 overflow-hidden text-left shadow-sm">
                <div className="aspect-square grid grid-cols-2 gap-0.5 bg-slate-100">
                  {imgs.slice(0, 4).map(i => <LazyImage key={i.id} id={i.id} thumbnail={i.thumbnail} className="w-full h-full" />)}
                  {Array.from({ length: 4 - imgs.length }).map((_, i) => <div key={i} className="bg-blue-50 flex items-center justify-center"><Layers className="w-5 h-5 text-blue-200" /></div>)}
                </div>
                <div className="p-2.5"><p className="text-sm font-semibold truncate">{c.name}</p><p className="text-[11px] text-slate-500">{imgs.length} images</p></div>
              </button>
            );
          })}
        </div>
      )}
      {showCreate && (
        <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold">New Collection</h3>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Wedding Season 2026" autoFocus className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
            <input value={theme} onChange={e => setTheme(e.target.value)} placeholder="Theme (optional)" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
            <div className="flex gap-2"><button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-lg bg-slate-100 text-sm font-medium">Cancel</button><button onClick={create} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium">Create</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function CollDetail({ coll, onBack }) {
  const { data, persistData, session, showToast } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const collImages = data.images.filter(i => coll.imageIds.includes(i.id));
  const canDelete = can(session, 'collection.delete') || (coll.createdBy === session.email);

  const remove = async (id) => { await persistData({ ...data, collections: data.collections.map(c => c.id === coll.id ? { ...c, imageIds: c.imageIds.filter(x => x !== id) } : c) }); showToast('Removed'); };
  const del = async () => {
    if (!canDelete) return showToast('Permission denied', 'error');
    if (!confirm('Delete this collection?')) return;
    await persistData({ ...data, collections: data.collections.filter(c => c.id !== coll.id) }); onBack();
  };

  const exportPDF = async () => {
    showToast('Building catalog PDF...');
    try {
      const fulls = await Promise.all(collImages.map(async i => ({ ...i, src: (await imageRepo.getFull(i.id)) || i.thumbnail })));
      const brand = data.settings?.brandName || 'Brinda Sweets Baker\'s Lounge';
      const wm = data.settings?.watermarkText || brand;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${coll.name} · ${brand}</title><style>
        @media print { @page { margin: 1cm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:24px;color:#1e293b;background:#fff}
        .brand-header{display:flex;align-items:center;gap:12px;padding:14px 18px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;color:#fff;margin-bottom:18px;box-shadow:0 4px 12px rgba(37,99,235,0.18)}
        .brand-badge{width:46px;height:46px;border-radius:10px;background:rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;font-size:22px;backdrop-filter:blur(6px)}
        .brand-name{font-size:18px;font-weight:700;letter-spacing:-0.01em;margin:0}
        .brand-tag{font-size:11px;opacity:0.85;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.06em}
        h1{font-size:26px;margin:0 0 6px;background:linear-gradient(135deg,#2563eb,#7c3aed);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
        .sub{color:#64748b;margin-bottom:18px;font-size:13px;border-bottom:1px solid #e2e8f0;padding-bottom:12px}
        .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
        .card{border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;page-break-inside:avoid;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.05)}
        .card img{width:100%;height:220px;object-fit:cover;display:block}
        .info{padding:10px 12px}
        .info p{margin:0;font-size:13px;font-weight:600;color:#1e293b}
        .tags{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
        .tag{font-size:10px;background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:6px}
        .f{margin-top:24px;text-align:center;padding-top:16px;border-top:2px solid #e2e8f0}
        .f .brand-line{font-size:13px;font-weight:600;color:#1e293b;margin:0 0 4px}
        .f .meta-line{font-size:10px;color:#94a3b8}
        .actions{position:fixed;top:16px;right:16px;display:flex;gap:8px;z-index:100}
        .actions button{padding:8px 16px;border-radius:8px;border:none;font-weight:600;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15)}
        .print-btn{background:#2563eb;color:#fff}
        .close-btn{background:#fff;color:#64748b;border:1px solid #e2e8f0!important}
        @media print { .actions{display:none} }
      </style></head><body>
        <div class="actions"><button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button><button class="close-btn" onclick="window.close()">Close</button></div>
        <div class="brand-header">
          <div class="brand-badge">🍰</div>
          <div>
            <p class="brand-name">${brand}</p>
            <p class="brand-tag">Curated Catalog</p>
          </div>
        </div>
        <h1>${coll.name}</h1>
        <div class="sub">${coll.theme ? coll.theme + ' · ' : ''}${fulls.length} items · Generated ${utils.date(Date.now())}</div>
        <div class="grid">${fulls.map(i => `<div class="card"><img src="${i.src}" alt=""/><div class="info"><p>${i.name}</p><div class="tags">${i.keywords.slice(0, 4).map(k => `<span class="tag">${k}</span>`).join('')}</div></div></div>`).join('')}</div>
        <div class="f">
          <p class="brand-line">${brand}</p>
          <p class="meta-line">${wm} · Powered by ImageVault</p>
        </div>
      </body></html>`;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast('Catalog opened — tap "Print / Save as PDF" to export');
    } catch (e) {
      showToast('PDF generation failed: ' + e.message, 'error');
    }
  };

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div className="flex items-start justify-between gap-2">
        <div><h2 className="text-xl font-bold">{coll.name}</h2>{coll.theme && <p className="text-xs text-slate-500">{coll.theme}</p>}<p className="text-xs text-slate-500">{collImages.length} images · by {coll.createdBy}</p></div>
        {canDelete && <button onClick={del} className="text-red-500 p-1"><Trash2 className="w-4 h-4" /></button>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setShowAdd(true)} className="bg-white border border-slate-200 rounded-lg p-2 text-xs font-medium flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>
        <button onClick={() => setShowShare(true)} disabled={!collImages.length} className="bg-emerald-500 text-white rounded-lg p-2 text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50"><Share2 className="w-3.5 h-3.5" /> Share</button>
        <button onClick={exportPDF} disabled={!collImages.length} className="bg-purple-500 text-white rounded-lg p-2 text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50"><FileText className="w-3.5 h-3.5" /> PDF</button>
      </div>
      <PaginatedGrid images={collImages} onSelect={() => {}} />
      {showAdd && <AddToColl coll={coll} onClose={() => setShowAdd(false)} />}
      {showShare && <ShareModal images={collImages} onClose={() => setShowShare(false)} />}
    </div>
  );
}

function AddToColl({ coll, onClose }) {
  const { data, persistData, showToast } = useApp();
  const [sel, setSel] = useState(new Set(coll.imageIds));
  const [search, setSearch] = useState('');
  const filtered = data.images.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.keywords.some(k => k.includes(search.toLowerCase())));

  const save = async () => { await persistData({ ...data, collections: data.collections.map(c => c.id === coll.id ? { ...c, imageIds: Array.from(sel) } : c) }); showToast('Saved'); onClose(); };

  return (
    <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100"><h3 className="text-lg font-bold mb-2">Pick Images</h3><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" /></div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-3 gap-2">
            {filtered.slice(0, 30).map(img => {
              const isS = sel.has(img.id);
              return (
                <button key={img.id} onClick={() => { const n = new Set(sel); n.has(img.id) ? n.delete(img.id) : n.add(img.id); setSel(n); }} className={`relative rounded-lg overflow-hidden border-2 ${isS ? 'border-blue-600' : 'border-transparent'}`}>
                  <div className="aspect-square"><LazyImage id={img.id} thumbnail={img.thumbnail} className="w-full h-full" /></div>
                  {isS && <div className="absolute inset-0 bg-blue-600/40 flex items-center justify-center"><Check className="w-6 h-6 text-white" /></div>}
                </button>
              );
            })}
          </div>
          {filtered.length > 30 && <p className="text-xs text-slate-400 text-center mt-2">Showing 30 of {filtered.length} — refine search</p>}
        </div>
        <div className="p-3 border-t border-slate-100 flex gap-2"><button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-slate-100 text-sm font-medium">Cancel</button><button onClick={save} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium">Save ({sel.size})</button></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
function SettingsTab({ onLogout }) {
  const { data, persistData, session, showToast, t, lang, setLang } = useApp();
  const [view, setView] = useState('main');
  const gupshupOn = data.settings?.gupshup?.enabled && !data.settings?.gupshup?.mockMode && data.settings?.gupshup?.workerUrl;
  const gupshupMock = data.settings?.gupshup?.mockMode;

  const exportJSON = async () => {
    showToast('Building backup...');
    const fulls = {};
    for (const img of data.images) {
      const f = await imageRepo.getFull(img.id);
      if (f) fulls[img.id] = f;
    }
    const blob = new Blob([JSON.stringify({ ...data, _images: fulls }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `imagevault-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded');
  };

  const exportCSV = () => {
    const rows = [['Name', 'Category', 'Subcategory', 'Keywords', 'Uploaded By', 'Date']];
    data.images.forEach(i => {
      const c = data.categories.find(x => x.id === i.categoryId);
      const s = c?.subcategories.find(x => x.id === i.subcategoryId);
      rows.push([i.name, c?.name || '', s?.name || '', i.keywords.join('; '), i.uploadedBy, utils.date(i.uploadedAt)]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `catalog-${Date.now()}.csv`; a.click();
    showToast('CSV downloaded');
  };

  const importJSON = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader();
    r.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!confirm('Overwrite current data?')) return;
        // Restore images to imageRepo
        if (parsed._images) for (const [id, full] of Object.entries(parsed._images)) await imageRepo.putFull(id, full);
        delete parsed._images;
        await persistData({ ...SEED, ...parsed });
        showToast('Restored');
      } catch { showToast('Invalid file', 'error'); }
    };
    r.readAsText(file);
  };

  if (view === 'keywords') return <KeywordsManager onBack={() => setView('main')} />;
  if (view === 'categories') return <CatManager onBack={() => setView('main')} />;
  if (view === 'invites') return <InvitesManager onBack={() => setView('main')} />;
  if (view === 'users') return <UsersView onBack={() => setView('main')} />;
  if (view === 'prefs') return <Prefs onBack={() => setView('main')} />;
  if (view === 'insights') return <InsightsScreen onBack={() => setView('main')} />;
  if (view === 'whatsapp') return <WhatsAppConfig onBack={() => setView('main')} />;
  if (view === 'wa_log') return <WhatsAppLog onBack={() => setView('main')} />;
  if (view === 'customers') return <CustomerBook onBack={() => setView('main')} />;
  if (view === 'firebase') return <FirebaseConfig onBack={() => setView('main')} />;
  if (view === 'forecast') return <DemandForecast onBack={() => setView('main')} />;
  if (view === 'activity') return <ActivityLogScreen onBack={() => setView('main')} />;

  const items = [
    { l: 'Insights', d: 'Analytics & trends', i: BarChart3, v: 'insights', s: can(session, 'view.insights') },
    { l: 'AI Demand Forecast', d: 'Claude-powered predictions', i: Sparkles, v: 'forecast', s: can(session, 'view.insights'), badge: 'AI' },
    { l: 'Activity Log', d: 'Full team history', i: Clock, v: 'activity', s: can(session, 'view.activity_log') },
    { l: 'Keywords', d: 'Edit tags', i: Tag, v: 'keywords', s: true },
    { l: 'WhatsApp API', d: gupshupOn ? 'Live · Gupshup configured' : (gupshupMock ? 'Mock mode active' : 'Configure Gupshup integration'), i: Send, v: 'whatsapp', s: can(session, 'system.whatsapp'), badge: gupshupOn ? 'LIVE' : (gupshupMock ? 'MOCK' : null) },
    { l: 'Firebase', d: data.firebase?.connected ? 'Connected · Project ' + data.firebase.projectId : 'Connect for sync & real-time', i: Zap, v: 'firebase', s: session.role === 'admin', badge: data.firebase?.connected ? 'LIVE' : null },
    { l: 'Message Log', d: `${(data.waMessageLog || []).length} sent messages`, i: Clock, v: 'wa_log', s: can(session, 'view.activity_log') },
    { l: 'Customer Book', d: `${(data.customers || []).length} saved contacts`, i: Users, v: 'customers', s: true },
    { l: 'Categories', d: 'Hierarchy', i: FolderTree, v: 'categories', s: can(session, 'category.create') },
    { l: 'Invites', d: 'Send via WhatsApp/Gmail', i: UserPlus, v: 'invites', s: can(session, 'user.invite') },
    { l: 'Team', d: 'Members & roles', i: Users, v: 'users', s: can(session, 'view.activity_log') },
    { l: 'Preferences', d: 'Theme, language, brand, security', i: Settings, v: 'prefs', s: can(session, 'system.preferences') },
  ];

  return (
    <div className="p-4 space-y-4">
      <div><h2 className="text-xl font-bold">{t.settings}</h2><p className="text-xs text-slate-500">Manage ImageVault</p></div>
      <div className={`rounded-xl p-4 text-white ${session.role === 'admin' ? 'bg-gradient-to-br from-purple-600 to-purple-800' : session.role === 'manager' ? 'bg-gradient-to-br from-blue-600 to-indigo-700' : 'bg-gradient-to-br from-slate-600 to-slate-800'}`}>
        <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-lg font-bold">{session.name[0]}</div><div className="flex-1"><p className="font-semibold">{session.name}</p><p className="text-xs opacity-90">{session.email}</p><p className="text-[10px] uppercase mt-0.5 inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full">{ROLES[session.role]?.icon} {ROLES[session.role]?.label}</p></div></div>
        <p className="text-[10px] opacity-80 mt-2">{ROLES[session.role]?.desc}</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm divide-y divide-slate-100 overflow-hidden">
        {items.filter(i => i.s).map(item => (
          <button key={item.v} onClick={() => setView(item.v)} className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 text-left">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><item.i className="w-4 h-4 text-slate-700" /></div>
            <div className="flex-1"><p className="text-sm font-medium flex items-center gap-1.5">{item.l}{item.badge && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${item.badge === 'LIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{item.badge}</span>}</p><p className="text-xs text-slate-500">{item.d}</p></div>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
        ))}
      </div>
      {can(session, 'system.backup') && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm divide-y divide-slate-100 overflow-hidden">
          <button onClick={exportJSON} className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 text-left">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center"><Download className="w-4 h-4 text-emerald-600" /></div>
            <div className="flex-1"><p className="text-sm font-medium">Backup (JSON)</p><p className="text-xs text-slate-500">Full data + images</p></div>
          </button>
          <button onClick={exportCSV} className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 text-left">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center"><FileText className="w-4 h-4 text-emerald-600" /></div>
            <div className="flex-1"><p className="text-sm font-medium">Export CSV</p><p className="text-xs text-slate-500">Catalog metadata</p></div>
          </button>
          {can(session, 'system.restore') && (
            <label className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 text-left cursor-pointer">
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center"><Upload className="w-4 h-4 text-amber-600" /></div>
              <div className="flex-1"><p className="text-sm font-medium">Restore Backup</p><p className="text-xs text-slate-500">From JSON</p></div>
              <input type="file" accept=".json" onChange={importJSON} className="hidden" />
            </label>
          )}
        </div>
      )}
      <button onClick={onLogout} className="w-full bg-white text-red-600 border border-red-200 py-3 rounded-xl font-medium flex items-center justify-center gap-2"><LogOut className="w-4 h-4" /> {t.signout}</button>
      <p className="text-[10px] text-slate-400 text-center">v3.0 · Modular · Lazy-loaded · Built with synergy 💼</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS SUB-SCREENS
// ═══════════════════════════════════════════════════════════════════════════
function Prefs({ onBack }) {
  const { data, persistData, lang, setLang, showToast } = useApp();
  const [s, setS] = useState(data.settings);
  const save = async () => { await persistData({ ...data, settings: s }); showToast('Saved'); };
  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <h2 className="text-xl font-bold">Preferences</h2>
      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase">Language</p>
        <div className="grid grid-cols-3 gap-2">
          {[['en', '🇬🇧 EN'], ['hi', '🇮🇳 HI'], ['pa', '🇮🇳 PA']].map(([id, l]) => (
            <button key={id} onClick={() => { setLang(id); setS({ ...s, lang: id }); }} className={`py-2 rounded-lg text-xs font-medium border ${lang === id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase">{t.branding}</p>
        <div>
          <label className="text-xs mb-1 block">Brand Name</label>
          <input value={s.brandName || ''} onChange={e => setS({ ...s, brandName: e.target.value })} placeholder="Brinda Sweets Baker's Lounge" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          <p className="text-[10px] text-slate-400 mt-1">Used in invite messages and shared catalogs</p>
        </div>
        <div>
          <label className="text-xs mb-1 block">{t.watermark} text</label>
          <input value={s.watermarkText} onChange={e => setS({ ...s, watermarkText: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer p-2 -m-2 rounded hover:bg-slate-50">
          <input type="checkbox" checked={!!s.autoWatermark} onChange={e => setS({ ...s, autoWatermark: e.target.checked })} className="w-4 h-4" />
          <div className="flex-1">
            <p className="text-xs font-medium flex items-center gap-1"><Droplet className="w-3 h-3 text-blue-500" /> {t.autoWM}</p>
            <p className="text-[10px] text-slate-500">Bakes watermark into every uploaded image</p>
          </div>
        </label>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase">📨 Invite Message Template</p>
        <div>
          <textarea value={s.inviteMessage || ''} onChange={e => setS({ ...s, inviteMessage: e.target.value })} rows={10} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono leading-relaxed" />
          <div className="text-[10px] text-slate-500 mt-1.5 space-y-0.5">
            <p>Available variables:</p>
            <p className="font-mono"><code className="bg-slate-100 px-1 rounded">{'{{code}}'}</code> · <code className="bg-slate-100 px-1 rounded">{'{{email}}'}</code> · <code className="bg-slate-100 px-1 rounded">{'{{expires}}'}</code> · <code className="bg-slate-100 px-1 rounded">{'{{brand}}'}</code></p>
            <p className="text-amber-600 mt-1">💡 Use *asterisks* for bold in WhatsApp</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase flex items-center gap-1"><Lock className="w-3 h-3" /> Security</p>
        <div><label className="text-xs mb-1 block">Session timeout (min)</label><input type="number" value={s.sessionTimeoutMin} onChange={e => setS({ ...s, sessionTimeoutMin: +e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" /></div>
      </div>
      <button onClick={save} className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium">Save</button>
    </div>
  );
}

function KeywordsManager({ onBack }) {
  const { data } = useApp();
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState(null);
  const filtered = data.images.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.keywords.some(k => k.toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div><h2 className="text-xl font-bold">Manage Keywords</h2><p className="text-xs text-slate-500">Edit tags on images</p></div>
      <div className="relative"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm" /></div>
      <PaginatedGrid images={filtered} onSelect={setSel} />
      {sel && <ImagePreview img={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function CatManager({ onBack }) {
  const { data, persistData, session, showToast } = useApp();
  const [nC, setNC] = useState(''); const [nI, setNI] = useState('📦'); const [nSF, setNSF] = useState(''); const [nSN, setNSN] = useState('');
  const canCreate = can(session, 'category.create');
  const canDelete = can(session, 'category.delete');

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div>
        <h2 className="text-xl font-bold">Categories</h2>
        {!canDelete && <p className="text-[10px] text-amber-600 mt-0.5">🎯 Manager: you can add/edit but not delete categories. Ask Admin for deletes.</p>}
      </div>
      {canCreate && (
        <div className="bg-white rounded-xl border border-slate-100 p-3 space-y-2">
          <p className="text-xs font-semibold">Add Category</p>
          <div className="flex gap-2">
            <input value={nI} onChange={e => setNI(e.target.value)} maxLength={2} className="w-12 text-center px-2 py-2 rounded-lg border border-slate-200 text-lg" />
            <input value={nC} onChange={e => setNC(e.target.value)} placeholder="Name" className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            <button onClick={() => { if (!nC.trim()) return; persistData({ ...data, categories: [...data.categories, { id: utils.uid('c'), name: nC.trim(), icon: nI, subcategories: [] }] }); setNC(''); setNI('📦'); showToast('Added'); }} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium">Add</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {data.categories.map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <div className="p-3 flex items-center gap-3">
              <span className="text-lg">{c.icon}</span>
              <p className="flex-1 text-sm font-semibold">{c.name}</p>
              {canDelete && <button onClick={() => { if (!confirm('Delete category and all its images?')) return; const subs = c.subcategories.map(s => s.id); persistData({ ...data, categories: data.categories.filter(x => x.id !== c.id), images: data.images.filter(i => !subs.includes(i.subcategoryId)) }); }} className="text-red-500 p-1"><Trash2 className="w-4 h-4" /></button>}
            </div>
            <div className="bg-slate-50/50 border-t border-slate-100">
              {c.subcategories.map(s => (
                <div key={s.id} className="px-4 py-2 flex items-center gap-2 border-b border-slate-100 last:border-b-0">
                  <div className="w-1 h-1 rounded-full bg-slate-400"></div>
                  <span className="flex-1 text-sm text-slate-700">{s.name}</span>
                  {canDelete && <button onClick={() => { if (!confirm('Delete sub + its images?')) return; persistData({ ...data, categories: data.categories.map(x => x.id === c.id ? { ...x, subcategories: x.subcategories.filter(y => y.id !== s.id) } : x), images: data.images.filter(i => i.subcategoryId !== s.id) }); }} className="text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
              {canCreate && (nSF === c.id ? <div className="p-3 flex gap-2">
                <input value={nSN} onChange={e => setNSN(e.target.value)} placeholder="Sub name" autoFocus className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                <button onClick={() => { if (!nSN.trim()) return; persistData({ ...data, categories: data.categories.map(x => x.id === c.id ? { ...x, subcategories: [...x.subcategories, { id: utils.uid('s'), name: nSN.trim() }] } : x) }); setNSN(''); setNSF(''); showToast('Added'); }} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium">Add</button>
                <button onClick={() => { setNSF(''); setNSN(''); }} className="px-2 py-2 rounded-lg bg-slate-100 text-sm">×</button>
              </div> : <button onClick={() => setNSF(c.id)} className="w-full p-2.5 text-xs text-blue-600 font-medium flex items-center justify-center gap-1"><Plus className="w-3 h-3" /> Add Subcategory</button>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InvitesManager({ onBack }) {
  const { data, persistData, session, showToast } = useApp();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('operator');
  const [gen, setGen] = useState(null);
  const canInviteManager = can(session, 'user.invite_manager');

  const generate = () => {
    if (!email.includes('@')) return showToast('Invalid email', 'error');
    if (role === 'manager' && !canInviteManager) return showToast('Only Admin can invite Managers', 'error');
    if (role === 'admin') return showToast('Promote an existing user to Admin from the Team screen', 'error');
    const prefix = role === 'manager' ? 'MGR' : 'INV';
    const code = prefix + Math.random().toString(36).slice(2, 7).toUpperCase();
    const inv = { code, email: email.trim().toLowerCase(), phone: phone.replace(/\D/g, '') || null, role, used: false, createdAt: Date.now(), expiresAt: Date.now() + CFG.INVITE_EXPIRY_DAYS * 86400000, invitedBy: session.email };
    persistData({ ...data, inviteCodes: [...data.inviteCodes, inv] });
    setGen(inv);
    setEmail(''); setPhone(''); setRole('operator');
  };

  const buildInviteMessage = (i) => {
    const tpl = data.settings?.inviteMessage || `🎉 *You're invited to ImageVault* 🎉\n\nHi! You've been invited to join our image catalog system.\n\n📌 *INVITE CODE:* {{code}}\n📧 *EMAIL:* {{email}}\n👔 *ROLE:* {{role}}\n⏰ *EXPIRES:* {{expires}}\n\nTo get started:\n1. Open the ImageVault app\n2. Tap "Join with Invite"\n3. Enter your email + the code above\n\n— {{brand}}`;
    const roleLabel = ROLES[i.role || 'operator']?.label || 'Operator';
    return tpl
      .replace(/\{\{code\}\}/g, i.code)
      .replace(/\{\{email\}\}/g, i.email)
      .replace(/\{\{role\}\}/g, `${ROLES[i.role || 'operator'].icon} ${roleLabel}`)
      .replace(/\{\{expires\}\}/g, utils.date(i.expiresAt))
      .replace(/\{\{brand\}\}/g, data.settings?.brandName || 'Brinda Sweets Baker\'s Lounge');
  };

  const sendG = (i) => {
    const subject = encodeURIComponent('Invite to ImageVault');
    const body = encodeURIComponent(buildInviteMessage(i).replace(/\*/g, ''));
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${i.email}&su=${subject}&body=${body}`, '_blank');
  };

  const sendWA = (i) => {
    const msg = encodeURIComponent(buildInviteMessage(i));
    const url = i.phone ? `https://wa.me/${i.phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(url, '_blank');
    showToast(i.phone ? 'Opening WhatsApp...' : 'Pick a contact in WhatsApp');
  };

  const copyInviteText = async (i) => {
    const ok = await copyToClipboard(buildInviteMessage(i));
    showToast(ok ? '✓ Invite text copied' : 'Copy failed', ok ? 'success' : 'error');
  };

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div><h2 className="text-xl font-bold">Send Invites</h2><p className="text-xs text-slate-500">Auto-expires in {CFG.INVITE_EXPIRY_DAYS} days</p></div>

      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1.5 block">Designation</label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setRole('operator')} className={`p-2.5 rounded-lg border text-left ${role === 'operator' ? 'border-slate-400 bg-slate-50' : 'border-slate-200'}`}>
              <p className="text-sm font-semibold">{ROLES.operator.icon} {ROLES.operator.label}</p>
              <p className="text-[10px] text-slate-500">{ROLES.operator.desc}</p>
            </button>
            <button onClick={() => canInviteManager ? setRole('manager') : showToast('Only Admin can invite Managers', 'error')} disabled={!canInviteManager} className={`p-2.5 rounded-lg border text-left ${role === 'manager' ? 'border-blue-400 bg-blue-50' : 'border-slate-200'} ${!canInviteManager ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <p className="text-sm font-semibold">{ROLES.manager.icon} {ROLES.manager.label}</p>
              <p className="text-[10px] text-slate-500">{canInviteManager ? ROLES.manager.desc : 'Admin only'}</p>
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Mail className="w-3 h-3" /> Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="newuser@gmail.com" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Phone className="w-3 h-3" /> WhatsApp <span className="text-slate-400 font-normal">(optional)</span></label>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
        </div>
        <button onClick={generate} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium text-sm">Generate {ROLES[role].label} Invite</button>
      </div>

      {gen && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1"><Check className="w-4 h-4" /> Generated</p>
          <div className="bg-white rounded-lg p-3 border border-emerald-200">
            <p className="text-[10px] text-slate-500 uppercase">Invite Code</p>
            <p className="text-lg font-mono font-bold">{gen.code}</p>
            <p className="text-xs text-slate-600">For: {gen.email}</p>
            {gen.phone && <p className="text-xs text-slate-600">📱 +{gen.phone}</p>}
            <p className="text-xs text-slate-600 mt-1">Designation: {ROLES[gen.role || 'operator'].icon} <b>{ROLES[gen.role || 'operator'].label}</b></p>
            <p className="text-[10px] text-slate-500">Expires: {utils.date(gen.expiresAt)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => sendWA(gen)} className="bg-emerald-500 text-white py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2"><Share2 className="w-4 h-4" /> WhatsApp</button>
            <button onClick={() => sendG(gen)} className="bg-red-500 text-white py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2"><Mail className="w-4 h-4" /> Gmail</button>
          </div>
          <button onClick={() => copyInviteText(gen)} className="w-full bg-purple-50 text-purple-700 py-2 rounded-lg font-medium text-xs flex items-center justify-center gap-2 border border-purple-200"><Copy className="w-3.5 h-3.5" /> Copy invite text</button>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2 px-1">All ({data.inviteCodes.length})</p>
        <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100">
          {data.inviteCodes.map(i => {
            const exp = i.expiresAt && i.expiresAt < Date.now();
            const r = ROLES[i.role || 'operator'];
            return (
              <div key={i.code} className="p-3 flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${i.used ? 'bg-slate-100' : exp ? 'bg-red-50' : 'bg-amber-50'}`}>
                  {i.used ? <Check className="w-4 h-4 text-slate-500" /> : exp ? <X className="w-4 h-4 text-red-600" /> : <Key className="w-4 h-4 text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5"><p className="text-sm font-mono font-bold">{i.code}</p><span className="text-[10px]">{r.icon}</span></div>
                  <p className="text-[11px] text-slate-500 truncate">{i.email}{i.phone && ` · +${i.phone}`}</p>
                </div>
                <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${i.used ? 'bg-slate-100 text-slate-500' : exp ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {i.used ? 'Used' : exp ? 'Expired' : 'Active'}
                </span>
                {!i.used && !exp && (
                  <>
                    <button onClick={() => sendWA(i)} className="text-emerald-600 p-1" title="WhatsApp"><Share2 className="w-4 h-4" /></button>
                    <button onClick={() => sendG(i)} className="text-blue-600 p-1" title="Gmail"><Mail className="w-4 h-4" /></button>
                  </>
                )}
                <button onClick={() => persistData({ ...data, inviteCodes: data.inviteCodes.filter(x => x.code !== i.code) })} className="text-red-500 p-1"><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UsersView({ onBack }) {
  const { data, persistData, session, showToast, logActivity } = useApp();
  const canPromote = can(session, 'user.promote');
  const canRemove = can(session, 'user.remove');
  const [editingUser, setEditingUser] = useState(null);

  const changeRole = async (user, newRole) => {
    if (!canPromote) return showToast('Only Admin can change roles', 'error');
    if (user.email === session.email) return showToast("You can't change your own role", 'error');
    if (user.role === 'admin' && newRole !== 'admin') {
      // Prevent removing last admin
      const adminCount = data.users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) return showToast('Cannot demote the last Admin', 'error');
    }
    await persistData({ ...data, users: data.users.map(u => u.email === user.email ? { ...u, role: newRole } : u) });
    logActivity('role_change', `${user.email}: ${user.role} → ${newRole}`);
    showToast(`${user.name} is now ${ROLES[newRole].label}`);
    setEditingUser(null);
  };

  const removeUser = async (user) => {
    if (!canRemove) return showToast('Only Admin can remove users', 'error');
    if (user.email === session.email) return showToast("You can't remove yourself", 'error');
    if (user.role === 'admin') {
      const adminCount = data.users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) return showToast('Cannot remove the last Admin', 'error');
    }
    if (!confirm(`Remove ${user.name} (${user.email})? They will lose access immediately.`)) return;
    await persistData({ ...data, users: data.users.filter(u => u.email !== user.email) });
    logActivity('user_remove', user.email);
    showToast(`${user.name} removed`);
  };

  // Group by role
  const grouped = { admin: [], manager: [], operator: [] };
  data.users.forEach(u => { (grouped[u.role] || grouped.operator).push(u); });

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div>
        <h2 className="text-xl font-bold">Team Members</h2>
        <p className="text-xs text-slate-500">{data.users.length} users · {grouped.admin.length} {ROLES.admin.label}{grouped.admin.length !== 1 ? 's' : ''} · {grouped.manager.length} {ROLES.manager.label}{grouped.manager.length !== 1 ? 's' : ''} · {grouped.operator.length} {ROLES.operator.label}{grouped.operator.length !== 1 ? 's' : ''}</p>
      </div>

      {!canPromote && <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-[11px] text-blue-800">
        🎯 As Manager you can view the team. Only Admin can promote/demote or remove users.
      </div>}

      {['admin', 'manager', 'operator'].map(roleKey => {
        const users = grouped[roleKey];
        if (users.length === 0) return null;
        const r = ROLES[roleKey];
        return (
          <div key={roleKey}>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2 px-1 flex items-center gap-1">
              <span>{r.icon}</span> {r.label}s ({users.length})
            </p>
            <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
              {users.map(u => {
                const isMe = u.email === session.email;
                const isEditing = editingUser === u.email;
                return (
                  <div key={u.email} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full text-white font-semibold flex items-center justify-center ${u.role === 'admin' ? 'bg-gradient-to-br from-purple-500 to-purple-700' : u.role === 'manager' ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-gradient-to-br from-slate-500 to-slate-600'}`}>{u.name[0]}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold flex items-center gap-1.5">{u.name}{isMe && <span className="text-[10px] text-emerald-600 font-medium">(you)</span>}</p>
                        <p className="text-[11px] text-slate-500 truncate">{u.email}</p>
                      </div>
                      {roleBadge(u.role)}
                      {canPromote && !isMe && <button onClick={() => setEditingUser(isEditing ? null : u.email)} className="text-blue-600 p-1"><Edit3 className="w-4 h-4" /></button>}
                    </div>
                    {isEditing && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Change Role</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {Object.entries(ROLES).map(([rk, rv]) => (
                            <button key={rk} onClick={() => changeRole(u, rk)} disabled={u.role === rk} className={`p-2 rounded-lg border text-xs font-medium ${u.role === rk ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white border-slate-200 hover:bg-blue-50 hover:border-blue-300'}`}>
                              <p>{rv.icon} {rv.label}</p>
                              {u.role === rk && <p className="text-[9px] mt-0.5">current</p>}
                            </button>
                          ))}
                        </div>
                        <button onClick={() => removeUser(u)} className="w-full mt-2 bg-red-50 text-red-600 py-2 rounded-lg text-xs font-medium border border-red-200 flex items-center justify-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Remove from team</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS
// ═══════════════════════════════════════════════════════════════════════════
function InsightsScreen({ onBack }) {
  const { data } = useApp();
  const stats = useMemo(() => {
    const sc = {}; (data.shareLog || []).forEach(s => { sc[s.imageId] = (sc[s.imageId] || 0) + 1; });
    const top = data.images.map(i => ({ ...i, shares: sc[i.id] || 0 })).sort((a, b) => b.shares - a.shares).slice(0, 5);
    const cs = {}; Object.entries(sc).forEach(([id, c]) => { const i = data.images.find(x => x.id === id); if (i) { const cat = data.categories.find(x => x.id === i.categoryId); if (cat) cs[cat.name] = (cs[cat.name] || 0) + c; } });
    const tc = Object.entries(cs).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const oa = {}; data.images.forEach(i => oa[i.uploadedBy] = (oa[i.uploadedBy] || 0) + 1);
    const tops = Object.entries(oa).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const kf = {}; data.images.forEach(i => i.keywords.forEach(k => kf[k] = (kf[k] || 0) + 1));
    const trd = Object.entries(kf).sort((a, b) => b[1] - a[1]).slice(0, 12);
    return { top, tc, tops, trd, ttls: (data.shareLog || []).length, log: (data.activityLog || []).slice(0, 10) };
  }, [data]);

  return (
    <div className="p-4 space-y-4">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div><h2 className="text-xl font-bold">Insights</h2><p className="text-xs text-slate-500">Analytics & trends</p></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white"><Share2 className="w-5 h-5 mb-2 opacity-80" /><p className="text-2xl font-bold">{stats.ttls}</p><p className="text-xs opacity-90">Total shares</p></div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-4 text-white"><Award className="w-5 h-5 mb-2 opacity-80" /><p className="text-2xl font-bold">{stats.tops.length}</p><p className="text-xs opacity-90">Active operators</p></div>
      </div>
      {stats.trd.length > 0 && <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-semibold uppercase mb-3 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Trending Keywords</p>
        <div className="flex flex-wrap gap-1.5">{stats.trd.map(([k, c]) => <span key={k} className="text-xs bg-purple-50 border border-purple-200 text-purple-700 px-2.5 py-1 rounded-full">{k} <span className="font-bold">·{c}</span></span>)}</div>
      </div>}
      {stats.top.filter(i => i.shares > 0).length > 0 && <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-semibold uppercase mb-3 flex items-center gap-1"><Zap className="w-3 h-3 text-amber-500" /> Most Shared</p>
        <div className="space-y-2">{stats.top.filter(i => i.shares > 0).map((img, idx) => (
          <div key={img.id} className="flex items-center gap-2.5"><span className="text-xs font-bold w-4">#{idx + 1}</span><div className="w-10 h-10 rounded overflow-hidden flex-shrink-0"><LazyImage id={img.id} thumbnail={img.thumbnail} className="w-full h-full" /></div><p className="flex-1 text-xs font-medium truncate">{img.name}</p><span className="text-xs font-semibold text-blue-600">{img.shares}×</span></div>
        ))}</div>
      </div>}
      {stats.tc.length > 0 && <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-semibold uppercase mb-3">Top Categories</p>
        {stats.tc.map(([n, c]) => { const m = stats.tc[0][1]; return (
          <div key={n} className="mb-2"><div className="flex items-center justify-between text-xs mb-0.5"><span className="font-medium">{n}</span><span className="text-slate-500">{c}</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: (c / m * 100) + '%' }} /></div></div>
        ); })}
      </div>}
      {stats.tops.length > 0 && <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-semibold uppercase mb-3 flex items-center gap-1"><Users className="w-3 h-3" /> Operator Leaderboard</p>
        {stats.tops.map(([e, c], i) => <div key={e} className="flex items-center gap-2.5 py-1.5"><span className="text-xs font-bold w-5">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span><p className="flex-1 text-xs truncate">{e}</p><span className="text-xs font-semibold">{c} uploads</span></div>)}
      </div>}
      {stats.log.length > 0 && <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-semibold uppercase mb-3 flex items-center gap-1"><Clock className="w-3 h-3" /> Recent Activity</p>
        <div className="space-y-1.5">{stats.log.map(l => <div key={l.id} className="flex items-center gap-2 text-xs"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /><span className="flex-1 truncate"><b>{l.user?.split('@')[0]}</b> {l.action.replace('_', ' ')} {l.detail && `· ${l.detail}`}</span><span className="text-[10px] text-slate-400">{utils.ago(l.ts)}</span></div>)}</div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP API CONFIG (with Cloudflare Worker code)
// ═══════════════════════════════════════════════════════════════════════════
function WhatsAppConfig({ onBack }) {
  const { data, persistData, showToast } = useApp();
  const [g, setG] = useState(data.settings?.gupshup || {});
  const [showCode, setShowCode] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const save = async () => {
    await persistData({ ...data, settings: { ...data.settings, gupshup: g } });
    showToast('WhatsApp config saved');
  };

  const testSend = async () => {
    setTesting(true); setTestResult(null);
    try {
      // Use a tiny test image (1×1 pixel jpeg)
      const testImg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAAH//2Q==';
      const r = await whatsappAPI.send({ phone: g.sourceNumber || '917527818018', imageDataUrl: testImg, caption: 'ImageVault test ping 🧪', config: g });
      setTestResult({ ok: true, ...r });
      showToast(g.mockMode ? '✓ Mock test successful' : '✓ Test message sent');
    } catch (e) {
      // Detect sandbox CSP block
      const msg = e.message || '';
      const isSandboxBlock = msg.includes('Failed to fetch') || msg.includes('Content Security Policy') || msg.includes('NetworkError');
      setTestResult({ ok: false, error: msg, sandbox: isSandboxBlock && !g.mockMode });
      showToast(isSandboxBlock && !g.mockMode ? 'Sandbox blocks live API — see details below' : msg, 'error');
    }
    setTesting(false);
  };

  const workerCode = `// ═══════════════════════════════════════════════════════════════════════════
// IMAGEVAULT → GUPSHUP WHATSAPP WORKER
// ═══════════════════════════════════════════════════════════════════════════
// Deploy this to Cloudflare Workers (free tier: 100,000 requests/day)
//
// SETUP:
// 1. Go to dash.cloudflare.com → Workers & Pages → Create Worker
// 2. Paste this code → Save and Deploy
// 3. Settings → Variables and Secrets → Add 2 SECRETS (encrypted):
//    - GUPSHUP_USERID  =  ${g.workerUrl ? '(set this)' : '2000257518'}
//    - GUPSHUP_PASSWORD = (your NEW Gupshup password — never the old one!)
// 4. Copy the Worker URL (e.g. https://xxx.workers.dev) into ImageVault
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = ['*']; // Tighten this in production to your app's domain

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405);
    }

    try {
      const body = await request.json();
      const { send_to, caption, media_url } = body;

      if (!send_to || !media_url) {
        return json({ error: 'Missing send_to or media_url' }, 400);
      }
      if (!env.GUPSHUP_USERID || !env.GUPSHUP_PASSWORD) {
        return json({ error: 'Worker secrets not configured' }, 500);
      }

      // Build Gupshup URL with encoded params
      const params = new URLSearchParams({
        userid: env.GUPSHUP_USERID,
        password: env.GUPSHUP_PASSWORD,
        send_to,
        v: '1.1',
        format: 'json',
        msg_type: 'IMAGE',
        method: 'SENDMEDIAMESSAGE',
        caption: caption || '',
        media_url,
        isTemplate: 'true',
      });

      const gupshupRes = await fetch('https://mediaapi.smsgupshup.com/GatewayAPI/rest?' + params.toString());
      const result = await gupshupRes.text();

      // Try to parse as JSON, fall back to text
      let parsed;
      try { parsed = JSON.parse(result); } catch { parsed = { raw: result }; }

      return json({ ok: gupshupRes.ok, status: gupshupRes.status, response: parsed, messageId: parsed?.response?.id || parsed?.messageId });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
`;

  const copyCode = async () => {
    const ok = await copyToClipboard(workerCode);
    showToast(ok ? '✓ Worker code copied' : 'Copy failed — select manually', ok ? 'success' : 'error');
  };

  return (
    <div className="p-4 space-y-3 pb-8">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2"><Send className="w-5 h-5 text-emerald-500" /> WhatsApp API</h2>
        <p className="text-xs text-slate-500">Direct Gupshup integration via Cloudflare Worker</p>
      </div>

      {/* Mode selector */}
      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase">Mode</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setG({ ...g, mockMode: true, enabled: true })} className={`p-3 rounded-lg border text-left ${g.mockMode ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
            <p className="text-sm font-semibold flex items-center gap-1">🧪 Mock Mode {g.mockMode && <Check className="w-3.5 h-3.5 text-amber-600" />}</p>
            <p className="text-[10px] text-slate-500">Test UI flow, no real messages</p>
          </button>
          <button onClick={() => setG({ ...g, mockMode: false, enabled: true })} className={`p-3 rounded-lg border text-left ${!g.mockMode && g.enabled ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
            <p className="text-sm font-semibold flex items-center gap-1">⚡ Live Mode {!g.mockMode && g.enabled && <Check className="w-3.5 h-3.5 text-emerald-600" />}</p>
            <p className="text-[10px] text-slate-500">Real WhatsApp via Gupshup</p>
          </button>
        </div>
      </div>

      {/* Cloudflare Worker setup */}
      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase">☁️ Cloudflare Worker</p>
          <button onClick={() => setShowGuide(!showGuide)} className="text-xs text-blue-600 font-medium">{showGuide ? 'Hide' : 'Setup guide'}</button>
        </div>
        {showGuide && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1 text-[11px] text-blue-900">
            <p className="font-semibold">5-step deployment (~30 minutes total):</p>
            <p>1️⃣ Sign up free at <span className="font-mono bg-white px-1 rounded">workers.cloudflare.com</span></p>
            <p>2️⃣ Click <b>Create Worker</b> → name it <span className="font-mono bg-white px-1 rounded">imagevault-wa</span></p>
            <p>3️⃣ Replace default code with the code below → <b>Save and Deploy</b></p>
            <p>4️⃣ Worker → Settings → <b>Variables and Secrets</b> → Add 2 SECRETS:</p>
            <p className="ml-3">• <span className="font-mono bg-white px-1 rounded">GUPSHUP_USERID</span> = <span className="font-mono">2000257518</span></p>
            <p className="ml-3">• <span className="font-mono bg-white px-1 rounded">GUPSHUP_PASSWORD</span> = your <b>new</b> Gupshup password</p>
            <p>5️⃣ Copy your Worker URL (looks like <span className="font-mono">https://imagevault-wa.xyz.workers.dev</span>) and paste below ⬇️</p>
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Worker URL</label>
          <input value={g.workerUrl || ''} onChange={e => setG({ ...g, workerUrl: e.target.value })} placeholder="https://imagevault-wa.xxx.workers.dev" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
        </div>
        <button onClick={() => setShowCode(!showCode)} className="w-full bg-slate-900 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
          <FileText className="w-4 h-4" /> {showCode ? 'Hide' : 'Show'} Worker Code (paste into Cloudflare)
        </button>
        {showCode && (
          <div className="space-y-2">
            <button onClick={copyCode} className="w-full bg-blue-600 text-white py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2"><Copy className="w-3.5 h-3.5" /> Copy entire code</button>
            <pre className="bg-slate-900 text-emerald-300 p-3 rounded-lg text-[10px] overflow-x-auto max-h-64 font-mono leading-relaxed">{workerCode}</pre>
          </div>
        )}
      </div>

      {/* Cloudinary */}
      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase">📸 Cloudinary (Image Hosting)</p>
        <p className="text-[10px] text-slate-500">WhatsApp needs a public URL to fetch images. Cloudinary's free tier handles this.</p>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Cloud Name</label>
          <input value={g.cloudinaryCloud || ''} onChange={e => setG({ ...g, cloudinaryCloud: e.target.value })} placeholder="my-bakery" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Upload Preset (unsigned)</label>
          <input value={g.cloudinaryPreset || ''} onChange={e => setG({ ...g, cloudinaryPreset: e.target.value })} placeholder="imagevault_uploads" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
      </div>

      {/* Gupshup details */}
      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase">📞 Gupshup Account</p>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">WhatsApp Business Number</label>
          <input value={g.sourceNumber || ''} onChange={e => setG({ ...g, sourceNumber: e.target.value })} placeholder="917527818018" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
          <p className="text-[10px] text-slate-400 mt-1">Format: country code + number, no + sign</p>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Default Caption</label>
          <textarea value={g.defaultCaption || ''} onChange={e => setG({ ...g, defaultCaption: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-800">
          🔒 <b>Security:</b> Your Gupshup userid + password live as <b>encrypted secrets in Cloudflare</b>, never in this app. Don't enter the password here.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={save} className="bg-blue-600 text-white py-3 rounded-xl font-semibold">Save</button>
        <button onClick={testSend} disabled={testing || !g.enabled} className="bg-emerald-500 text-white py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
          {testing ? <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</> : <><Zap className="w-4 h-4" /> Test Send</>}
        </button>
      </div>

      {testResult && (
        <div className={`rounded-lg p-3 text-xs ${testResult.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
          {testResult.ok ? <p className="font-semibold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Test successful</p> : <p className="font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Test failed</p>}
          {testResult.messageId && <p className="text-[10px] mt-1 font-mono">ID: {testResult.messageId}</p>}
          {testResult.error && <p className="text-[10px] mt-1">{testResult.error}</p>}
          {testResult.sandbox && (
            <div className="mt-2 pt-2 border-t border-red-200 space-y-1">
              <p className="font-semibold text-[11px]">⚠️ Artifact preview blocks external API calls</p>
              <p className="text-[10px]">This is a Claude sandbox security restriction (CSP). Your code is correct — the preview just can't reach Cloudinary/Cloudflare.</p>
              <p className="text-[10px] mt-1.5"><b>To test live API:</b></p>
              <p className="text-[10px]">1. Switch to 🧪 Mock Mode here to validate the UX</p>
              <p className="text-[10px]">2. Deploy ImageVault to Vercel/Netlify/Cloudflare Pages</p>
              <p className="text-[10px]">3. Test live mode from the deployed URL</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP MESSAGE LOG
// ═══════════════════════════════════════════════════════════════════════════
function WhatsAppLog({ onBack }) {
  const { data } = useApp();
  const log = (data.waMessageLog || []).slice().reverse();
  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div><h2 className="text-xl font-bold">Message Log</h2><p className="text-xs text-slate-500">{log.length} WhatsApp messages</p></div>
      {log.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-200 p-10 text-center">
          <Send className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No messages yet</p>
          <p className="text-xs text-slate-400 mt-1">Use Direct API mode in Share to send</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
          {log.map(m => (
            <div key={m.id} className="p-3 flex items-start gap-2.5">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${m.status === 'sent' ? (m.mock ? 'bg-amber-50' : 'bg-emerald-50') : 'bg-red-50'}`}>
                {m.status === 'sent' ? <Check className={`w-4 h-4 ${m.mock ? 'text-amber-600' : 'text-emerald-600'}`} /> : <X className="w-4 h-4 text-red-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm font-semibold truncate">{m.imageName}</p>
                  {m.mock && <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold">MOCK</span>}
                </div>
                <p className="text-[11px] text-slate-500">→ +{m.phone} · {utils.ago(m.ts)}</p>
                {m.error && <p className="text-[10px] text-red-600 mt-0.5">{m.error}</p>}
                {m.messageId && <p className="text-[9px] text-slate-400 font-mono mt-0.5">{m.messageId}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER PHONE BOOK
// ═══════════════════════════════════════════════════════════════════════════
function CustomerBook({ onBack }) {
  const { data, persistData, session, showToast } = useApp();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState('');
  const customers = data.customers || [];
  const filtered = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search.replace(/\D/g, '')));
  const canEdit = can(session, 'customer.edit');

  const add = async () => {
    if (!canEdit) return showToast('Operators have read-only access to the customer book', 'error');
    if (!name.trim() || !phone.trim()) return showToast('Name + phone required', 'error');
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) return showToast('Invalid phone', 'error');
    if (customers.find(c => c.phone === cleanPhone)) return showToast('Already in book', 'error');
    await persistData({ ...data, customers: [...customers, { id: utils.uid('cust'), name: name.trim(), phone: cleanPhone, createdAt: Date.now(), addedBy: session.email }] });
    setName(''); setPhone('');
    showToast('Customer added');
  };

  const del = async (id) => {
    if (!canEdit) return showToast('Operators cannot delete customers', 'error');
    if (!confirm('Delete?')) return;
    await persistData({ ...data, customers: customers.filter(c => c.id !== id) });
  };

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div>
        <h2 className="text-xl font-bold">Customer Book</h2>
        <p className="text-xs text-slate-500">{customers.length} saved contacts{!canEdit && ' · read-only'}</p>
      </div>
      {canEdit && (
        <div className="bg-white rounded-xl border border-slate-100 p-3 space-y-2">
          <p className="text-xs font-semibold">Add Customer</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="98765 43210" className="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
          <button onClick={add} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">Add</button>
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm" />
      </div>
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-200 p-10 text-center">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{customers.length === 0 ? 'No customers yet' : 'No match'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
          {filtered.map(c => {
            const sentCount = (data.waMessageLog || []).filter(m => m.phone === c.phone).length;
            return (
              <div key={c.id} className="p-3 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white font-semibold flex items-center justify-center text-sm">{c.name[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <p className="text-[11px] text-slate-500">+{c.phone} · {sentCount} message{sentCount !== 1 ? 's' : ''} sent</p>
                </div>
                {canEdit && <button onClick={() => del(c.id)} className="text-red-500 p-1"><Trash2 className="w-4 h-4" /></button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL SEARCH (Cmd+K / Ctrl+K)
// ═══════════════════════════════════════════════════════════════════════════
function UniversalSearch() {
  const { data, session } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    const matches = { images: [], customers: [], collections: [],   campaigns: [],
  notifications: [],
  imageVersions: {},
  firebase: { connected: false, projectId: '', apiKey: '', authDomain: '', storageBucket: '', appId: '', useFirestore: false, useStorage: false, useAuth: false }, settings: [] };
    matches.images = data.images.filter(i => i.name.toLowerCase().includes(q) || i.keywords.some(k => k.toLowerCase().includes(q))).slice(0, 5);
    matches.customers = (data.customers || []).filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 5);
    matches.collections = (data.collections || []).filter(c => c.name.toLowerCase().includes(q) || (c.theme || '').toLowerCase().includes(q)).slice(0, 5);
    matches.campaigns = (data.campaigns || []).filter(c => c.name.toLowerCase().includes(q)).slice(0, 5);
    const settingsMap = [
      { l: 'WhatsApp API', kw: 'whatsapp api gupshup' },
      { l: 'Categories', kw: 'categories taxonomy' },
      { l: 'Invites', kw: 'invites send team invite' },
      { l: 'Team', kw: 'team users members staff' },
      { l: 'Preferences', kw: 'preferences settings language brand watermark' },
      { l: 'Insights', kw: 'insights analytics stats' },
      { l: 'Customer Book', kw: 'customers contacts phone book' },
      { l: 'Message Log', kw: 'log messages history' },
    ];
    matches.settings = settingsMap.filter(s => s.l.toLowerCase().includes(q) || s.kw.includes(q)).slice(0, 4);
    return matches;
  }, [query, data]);

  const totalResults = results ? Object.values(results).reduce((acc, arr) => acc + arr.length, 0) : 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[100] flex items-start justify-center p-4 pt-[10vh]" onClick={() => setOpen(false)}>
      <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <Search className="w-5 h-5 text-slate-400" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search images, customers, collections, settings..." className="flex-1 bg-transparent outline-none text-base placeholder-slate-400 dark:text-white" />
          <kbd className="text-[10px] bg-slate-100 dark:bg-slate-700 dark:text-slate-300 px-2 py-1 rounded font-mono">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="p-6 text-center">
              <Search className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Start typing to search across everything</p>
              <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                {['cake', 'wedding', 'diwali', 'chocolate'].map(s => (
                  <button key={s} onClick={() => setQuery(s)} className="text-xs bg-slate-100 dark:bg-slate-700 dark:text-slate-300 px-3 py-1 rounded-full">{s}</button>
                ))}
              </div>
              <div className="mt-4 text-[10px] text-slate-400">
                <kbd className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded font-mono">⌘K</kbd> or <kbd className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded font-mono">Ctrl+K</kbd> opens search anywhere
              </div>
            </div>
          ) : totalResults === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No results for "{query}"</div>
          ) : (
            <div className="space-y-3">
              {results.images.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-500 px-2 py-1">Images ({results.images.length})</p>
                  {results.images.map(img => (
                    <button key={img.id} onClick={() => setOpen(false)} className="w-full flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-left">
                      <img src={img.thumbnail} className="w-10 h-10 rounded object-cover" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium dark:text-white truncate">{img.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{img.keywords.slice(0, 4).join(' · ')}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {results.customers.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-500 px-2 py-1">Customers ({results.customers.length})</p>
                  {results.customers.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                      <div className="w-9 h-9 rounded-full bg-emerald-500 text-white font-semibold flex items-center justify-center text-sm">{c.name[0]}</div>
                      <div className="flex-1"><p className="text-sm font-medium dark:text-white">{c.name}</p><p className="text-[11px] text-slate-500">+{c.phone}</p></div>
                    </div>
                  ))}
                </div>
              )}
              {results.collections.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-500 px-2 py-1">Lookbooks ({results.collections.length})</p>
                  {results.collections.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                      <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center"><Layers className="w-4 h-4 text-purple-600" /></div>
                      <div className="flex-1"><p className="text-sm font-medium dark:text-white">{c.name}</p><p className="text-[11px] text-slate-500">{c.imageIds.length} images</p></div>
                    </div>
                  ))}
                </div>
              )}
              {results.campaigns.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-500 px-2 py-1">Campaigns ({results.campaigns.length})</p>
                  {results.campaigns.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                      <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center"><Sparkles className="w-4 h-4 text-amber-600" /></div>
                      <div className="flex-1"><p className="text-sm font-medium dark:text-white">{c.name}</p><p className="text-[11px] text-slate-500">{c.imageIds?.length || 0} items</p></div>
                    </div>
                  ))}
                </div>
              )}
              {results.settings.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-500 px-2 py-1">Settings</p>
                  {results.settings.map(s => (
                    <div key={s.l} className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><Settings className="w-4 h-4 text-slate-600" /></div>
                      <p className="text-sm font-medium dark:text-white">{s.l}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FESTIVE CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════
const FESTIVAL_PRESETS = [
  { id: 'diwali', name: 'Diwali', emoji: '🪔', month: 10, color: 'from-amber-500 to-orange-600', kwHints: ['diwali', 'mithai', 'hamper', 'gift', 'festival'], message: '🪔 *Diwali Special* 🪔\n\nDear {{customer_name}}, our handpicked Diwali collection is ready! Order before {{deadline}} to ensure delivery.\n\n— {{brand}}' },
  { id: 'wedding', name: 'Wedding Season', emoji: '💍', month: 11, color: 'from-pink-500 to-rose-600', kwHints: ['wedding', 'shaadi', 'engagement', 'tier'], message: '💍 *Wedding Season Showcase*\n\nHi {{customer_name}}, our premium wedding collection is now showcasing. Book your tasting before {{deadline}}.\n\n— {{brand}}' },
  { id: 'christmas', name: 'Christmas', emoji: '🎄', month: 12, color: 'from-emerald-500 to-green-700', kwHints: ['christmas', 'plum', 'cake', 'cookies'], message: '🎄 *Merry Christmas from {{brand}}* 🎄\n\nHi {{customer_name}}, our festive Christmas collection is here. Plum cakes, cookies & more!\n\nOrder by {{deadline}}.' },
  { id: 'rakhi', name: 'Raksha Bandhan', emoji: '🎀', month: 8, color: 'from-purple-500 to-pink-600', kwHints: ['rakhi', 'sweets', 'gift', 'hamper'], message: '🎀 *Rakhi Special Hampers* 🎀\n\nHi {{customer_name}}, celebrate the bond with our curated Rakhi hampers. Order by {{deadline}}.\n\n— {{brand}}' },
  { id: 'holi', name: 'Holi', emoji: '🎨', month: 3, color: 'from-fuchsia-500 to-purple-600', kwHints: ['holi', 'gujiya', 'sweets', 'colorful'], message: '🎨 *Happy Holi from {{brand}}* 🎨\n\n{{customer_name}}, add color to your celebration with our festive sweets.\n\nOrder by {{deadline}}.' },
  { id: 'eid', name: 'Eid', emoji: '🌙', month: 4, color: 'from-teal-500 to-cyan-600', kwHints: ['eid', 'sheer', 'sweets', 'kheer', 'dates'], message: '🌙 *Eid Mubarak from {{brand}}* 🌙\n\n{{customer_name}}, celebrate with our handcrafted Eid specials.\n\nOrder by {{deadline}}.' },
  { id: 'newyear', name: 'New Year', emoji: '🎊', month: 1, color: 'from-indigo-500 to-blue-700', kwHints: ['new year', 'celebration', 'cake', 'champagne'], message: '🎊 *New Year Cheers from {{brand}}* 🎊\n\n{{customer_name}}, ring in the new year with our celebration cakes.\n\nOrder by {{deadline}}.' },
  { id: 'birthday', name: 'Birthday', emoji: '🎂', month: 0, color: 'from-blue-500 to-indigo-600', kwHints: ['birthday', 'cake', 'theme'], message: '🎂 Hi {{customer_name}}!\n\nMaking a birthday extra special? Browse our themed birthday cakes.\n\n— {{brand}}' },
];

function CampaignsTab() {
  const { data, persistData, session, showToast, logActivity } = useApp();
  const [activeView, setActiveView] = useState('list');
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const canCreate = can(session, 'collection.create');

  const createFromPreset = async (preset) => {
    const matchedImages = data.images.filter(i => preset.kwHints.some(h => i.keywords.some(k => k.toLowerCase().includes(h.toLowerCase()))));
    const lastYearShares = (data.shareLog || []).filter(s => {
      const img = data.images.find(i => i.id === s.imageId);
      return img && preset.kwHints.some(h => img.keywords.some(k => k.toLowerCase().includes(h.toLowerCase())));
    });
    const deadline = new Date();
    deadline.setMonth(preset.month - 1);
    if (deadline < new Date()) deadline.setFullYear(deadline.getFullYear() + 1);
    deadline.setDate(deadline.getDate() - 5); // 5 days before festival

    const campaign = {
      id: utils.uid('camp'),
      presetId: preset.id,
      name: `${preset.emoji} ${preset.name} ${new Date().getFullYear()}`,
      emoji: preset.emoji,
      color: preset.color,
      message: preset.message,
      imageIds: matchedImages.map(i => i.id),
      deadline: deadline.getTime(),
      createdAt: Date.now(),
      createdBy: session.email,
      lastYearShares: lastYearShares.length,
      sentTo: [],
      status: 'draft',
    };
    await persistData({ ...data, campaigns: [...(data.campaigns || []), campaign] });
    logActivity('campaign_create', preset.name);
    showToast(`✨ ${preset.name} campaign created with ${matchedImages.length} images`);
    setActiveCampaign(campaign);
    setActiveView('detail');
    setShowNew(false);
  };

  if (activeView === 'detail' && activeCampaign) {
    return <CampaignDetail campaign={activeCampaign} onBack={() => { setActiveCampaign(null); setActiveView('list'); }} />;
  }

  const campaigns = data.campaigns || [];
  const month = new Date().getMonth();
  const upcomingPresets = FESTIVAL_PRESETS.filter(p => {
    if (p.month === 0) return false;
    const m = p.month - 1;
    const diff = (m - month + 12) % 12;
    return diff <= 2;
  }).sort((a, b) => ((a.month - 1 - month + 12) % 12) - ((b.month - 1 - month + 12) % 12));

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold dark:text-white">Festive Campaigns</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Curated collections for seasonal moments</p>
        </div>
        {canCreate && <button onClick={() => setShowNew(!showNew)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> New</button>}
      </div>

      {upcomingPresets.length > 0 && (
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Upcoming Festivals</p>
          {upcomingPresets.slice(0, 2).map(p => {
            const lastYear = (data.shareLog || []).filter(s => {
              const img = data.images.find(i => i.id === s.imageId);
              return img && p.kwHints.some(h => img.keywords.some(k => k.toLowerCase().includes(h.toLowerCase())));
            }).length;
            const matched = data.images.filter(i => p.kwHints.some(h => i.keywords.some(k => k.toLowerCase().includes(h.toLowerCase())))).length;
            return (
              <div key={p.id} className="bg-white dark:bg-slate-800 rounded-lg p-2.5 flex items-center gap-2.5">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center text-xl`}>{p.emoji}</div>
                <div className="flex-1">
                  <p className="text-sm font-semibold dark:text-white">{p.name}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{matched} matching images · {lastYear} shares last year</p>
                </div>
                {canCreate && <button onClick={() => createFromPreset(p)} className="text-xs bg-amber-500 text-white px-2.5 py-1 rounded-lg font-medium">Create</button>}
              </div>
            );
          })}
        </div>
      )}

      {showNew && canCreate && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3 space-y-2">
          <p className="text-xs font-semibold dark:text-white">Pick a Preset</p>
          <div className="grid grid-cols-2 gap-2">
            {FESTIVAL_PRESETS.map(p => (
              <button key={p.id} onClick={() => createFromPreset(p)} className={`bg-gradient-to-br ${p.color} text-white p-3 rounded-lg text-left`}>
                <div className="text-2xl mb-1">{p.emoji}</div>
                <p className="text-xs font-semibold">{p.name}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {campaigns.length === 0 && !showNew ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center">
          <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No campaigns yet</p>
          <p className="text-xs text-slate-400 mt-1">Tap <b>New</b> or use a suggestion above</p>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map(c => {
            const daysLeft = Math.ceil((c.deadline - Date.now()) / 86400000);
            const sentCount = (c.sentTo || []).length;
            const progress = c.imageIds?.length || 0;
            return (
              <button key={c.id} onClick={() => { setActiveCampaign(c); setActiveView('detail'); }} className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3 flex items-center gap-3 hover:shadow-md transition text-left">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center text-2xl flex-shrink-0`}>{c.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold dark:text-white">{c.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{progress} images · {sentCount} sent</p>
                  {daysLeft > 0 && daysLeft < 30 && <p className="text-[10px] text-amber-600 font-semibold">⏰ {daysLeft} days left</p>}
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CampaignDetail({ campaign, onBack }) {
  const { data, persistData, session, showToast, logActivity } = useApp();
  const [activeCamp, setActiveCamp] = useState(campaign);
  const [showAddImages, setShowAddImages] = useState(false);
  const [showSendBulk, setShowSendBulk] = useState(false);
  const [editMessage, setEditMessage] = useState(false);
  const [msgDraft, setMsgDraft] = useState(activeCamp.message);
  const campImages = data.images.filter(i => activeCamp.imageIds?.includes(i.id));
  const daysLeft = Math.ceil((activeCamp.deadline - Date.now()) / 86400000);
  const canEdit = can(session, 'collection.edit', activeCamp);

  const updateCamp = async (updates) => {
    const updated = { ...activeCamp, ...updates };
    setActiveCamp(updated);
    await persistData({ ...data, campaigns: data.campaigns.map(c => c.id === activeCamp.id ? updated : c) });
  };

  const removeImage = (id) => updateCamp({ imageIds: activeCamp.imageIds.filter(x => x !== id) });

  const saveMessage = async () => {
    await updateCamp({ message: msgDraft });
    setEditMessage(false);
    showToast('Message saved');
  };

  const deleteCampaign = async () => {
    if (!confirm('Delete this campaign?')) return;
    await persistData({ ...data, campaigns: data.campaigns.filter(c => c.id !== activeCamp.id) });
    showToast('Deleted');
    onBack();
  };

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>

      <div className={`bg-gradient-to-br ${activeCamp.color} rounded-2xl p-5 text-white`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-3xl mb-2">{activeCamp.emoji}</div>
            <h2 className="text-2xl font-bold">{activeCamp.name}</h2>
            <p className="text-xs opacity-90 mt-1">{campImages.length} images · {(activeCamp.sentTo || []).length} sent</p>
          </div>
          {canEdit && <button onClick={deleteCampaign} className="bg-white/20 backdrop-blur p-2 rounded-lg"><Trash2 className="w-4 h-4" /></button>}
        </div>
        {daysLeft > 0 && (
          <div className="mt-3 bg-white/20 backdrop-blur rounded-lg p-2 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <p className="text-xs font-medium">Deadline: {utils.date(activeCamp.deadline)} · <b>{daysLeft} days left</b></p>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold dark:text-white">Campaign Message</p>
          {canEdit && <button onClick={() => setEditMessage(!editMessage)} className="text-xs text-blue-600 font-medium">{editMessage ? 'Cancel' : 'Edit'}</button>}
        </div>
        {editMessage ? (
          <div className="space-y-2">
            <textarea value={msgDraft} onChange={e => setMsgDraft(e.target.value)} rows={6} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white text-xs font-mono" />
            <div className="text-[10px] text-slate-500">Variables: {'{{customer_name}}'}, {'{{deadline}}'}, {'{{brand}}'}</div>
            <button onClick={saveMessage} className="w-full bg-blue-600 text-white py-2 rounded-lg text-xs font-medium">Save</button>
          </div>
        ) : (
          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{activeCamp.message}</p>
        )}
      </div>

      {canEdit && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setShowAddImages(true)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-xs font-medium flex items-center justify-center gap-1 dark:text-white"><Plus className="w-3.5 h-3.5" /> Add Images</button>
          <button onClick={() => setShowSendBulk(true)} disabled={campImages.length === 0} className="bg-emerald-500 text-white rounded-lg p-2.5 text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50"><Send className="w-3.5 h-3.5" /> Bulk Send</button>
        </div>
      )}

      {(activeCamp.sentTo || []).length > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 mb-1.5">📊 Campaign Performance</p>
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Sent to {activeCamp.sentTo.length} customer{activeCamp.sentTo.length !== 1 ? 's' : ''}</p>
          {activeCamp.lastYearShares > 0 && <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Last year: {activeCamp.lastYearShares} shares for {activeCamp.emoji}-tagged items</p>}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2 px-1">Campaign Images ({campImages.length})</p>
        {campImages.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
            <ImageIcon className="w-8 h-8 text-slate-300 mx-auto mb-1" />
            <p className="text-xs text-slate-500">No images yet — tap "Add Images"</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {campImages.map(img => (
              <div key={img.id} className="relative bg-white dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700">
                <div className="aspect-square"><LazyImage id={img.id} thumbnail={img.thumbnail} className="w-full h-full" /></div>
                {canEdit && <button onClick={() => removeImage(img.id)} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center"><X className="w-3 h-3" /></button>}
                <div className="p-2"><p className="text-xs font-medium truncate dark:text-white">{img.name}</p></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddImages && <AddToCampaign campaign={activeCamp} onClose={() => setShowAddImages(false)} onUpdate={updateCamp} />}
      {showSendBulk && <CampaignBulkSend campaign={activeCamp} images={campImages} onClose={() => setShowSendBulk(false)} onUpdate={updateCamp} />}
    </div>
  );
}

function AddToCampaign({ campaign, onClose, onUpdate }) {
  const { data, showToast } = useApp();
  const [sel, setSel] = useState(new Set(campaign.imageIds || []));
  const [search, setSearch] = useState('');
  const filtered = data.images.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.keywords.some(k => k.includes(search.toLowerCase())));

  const save = async () => {
    await onUpdate({ imageIds: Array.from(sel) });
    showToast('Updated');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-700"><h3 className="text-lg font-bold dark:text-white mb-2">Pick Images</h3><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white text-sm" /></div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-3 gap-2">
            {filtered.slice(0, 30).map(img => {
              const isS = sel.has(img.id);
              return (
                <button key={img.id} onClick={() => { const n = new Set(sel); n.has(img.id) ? n.delete(img.id) : n.add(img.id); setSel(n); }} className={`relative rounded-lg overflow-hidden border-2 ${isS ? 'border-blue-600' : 'border-transparent'}`}>
                  <div className="aspect-square"><LazyImage id={img.id} thumbnail={img.thumbnail} className="w-full h-full" /></div>
                  {isS && <div className="absolute inset-0 bg-blue-600/40 flex items-center justify-center"><Check className="w-6 h-6 text-white" /></div>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-3 border-t border-slate-100 dark:border-slate-700 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-slate-100 dark:bg-slate-700 dark:text-white text-sm font-medium">Cancel</button>
          <button onClick={save} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium">Save ({sel.size})</button>
        </div>
      </div>
    </div>
  );
}

function CampaignBulkSend({ campaign, images, onClose, onUpdate }) {
  const { data, persistData, session, showToast, logActivity } = useApp();
  const customers = data.customers || [];
  const [sel, setSel] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);

  const renderMsg = (customerName) => {
    return campaign.message
      .replace(/\{\{customer_name\}\}/g, customerName || 'there')
      .replace(/\{\{deadline\}\}/g, utils.date(campaign.deadline))
      .replace(/\{\{brand\}\}/g, data.settings?.brandName || 'Brinda Sweets');
  };

  const send = async () => {
    if (sel.size === 0) return showToast('Pick at least one customer', 'error');
    setSending(true);
    const sentCustomerIds = [];
    const newWaLogs = [];
    const cfg = data.settings?.gupshup || {};
    let okCount = 0;

    for (const custId of sel) {
      const cust = customers.find(c => c.id === custId);
      if (!cust) continue;
      try {
        for (const img of images) {
          if (cfg.enabled && (cfg.workerUrl || cfg.mockMode)) {
            const full = await imageRepo.getFull(img.id) || img.thumbnail;
            const result = await whatsappAPI.send({ phone: cust.phone, imageDataUrl: full, caption: `${renderMsg(cust.name)}\n\n${img.name}`, config: cfg });
            newWaLogs.push({ id: utils.uid('wa'), imageId: img.id, imageName: img.name, phone: result.sentTo, status: 'sent', mock: !!result.mock, messageId: result.messageId, ts: Date.now(), user: session.email, campaignId: campaign.id });
          }
        }
        sentCustomerIds.push(custId);
        okCount++;
        setResults(prev => [...prev, { custId, name: cust.name, ok: true }]);
      } catch (e) {
        setResults(prev => [...prev, { custId, name: cust.name, ok: false, error: e.message }]);
      }
    }

    await persistData({ ...data, waMessageLog: [...(data.waMessageLog || []), ...newWaLogs] });
    await onUpdate({ sentTo: [...(campaign.sentTo || []), ...sentCustomerIds.map(id => ({ customerId: id, ts: Date.now() }))] });
    logActivity('campaign_send', `${campaign.name}: ${okCount}/${sel.size}`);
    showToast(`✓ Sent to ${okCount}/${sel.size} customers`);
    setSending(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold dark:text-white">Bulk Send Campaign</h3>
          <p className="text-xs text-slate-500">{images.length} images × {sel.size} customers = {images.length * sel.size} messages</p>
        </div>
        {customers.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Add customers to your phone book first</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <button onClick={() => setSel(sel.size === customers.length ? new Set() : new Set(customers.map(c => c.id)))} className="w-full text-xs text-blue-600 font-medium py-1.5">{sel.size === customers.length ? 'Deselect all' : 'Select all'}</button>
              {customers.map(c => {
                const isS = sel.has(c.id);
                const result = results.find(r => r.custId === c.id);
                return (
                  <button key={c.id} onClick={() => { if (sending) return; const n = new Set(sel); n.has(c.id) ? n.delete(c.id) : n.add(c.id); setSel(n); }} className={`w-full flex items-center gap-2 p-2 rounded-lg ${isS ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${isS ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>{isS && <Check className="w-3.5 h-3.5 text-white" />}</div>
                    <div className="w-8 h-8 rounded-full bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center">{c.name[0]}</div>
                    <div className="flex-1 text-left"><p className="text-sm font-medium dark:text-white">{c.name}</p><p className="text-[10px] text-slate-500">+{c.phone}</p></div>
                    {result && (result.ok ? <Check className="w-4 h-4 text-emerald-500" /> : <X className="w-4 h-4 text-red-500" />)}
                  </button>
                );
              })}
            </div>
            <div className="p-3 border-t border-slate-100 dark:border-slate-700">
              <button onClick={send} disabled={sending || sel.size === 0} className="w-full bg-emerald-500 text-white py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending {results.length}/{sel.size}...</> : <><Send className="w-4 h-4" /> Send Campaign</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY FEED COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
function ActivityFeed({ limit = 20, compact = false }) {
  const { data } = useApp();
  const log = (data.activityLog || []).slice(0, limit);
  if (log.length === 0) return <p className="text-xs text-slate-400 text-center py-4">No activity yet</p>;
  const ICONS = { upload: Upload, share: Share2, wa_send: Send, bulk_share: Share2, bulk_tag: Tag, bulk_delete: Trash2, edit_kw: Edit3, del: Trash2, role_change: Users, user_remove: X, campaign_create: Sparkles, campaign_send: Send };
  const COLORS = { upload: 'text-blue-500 bg-blue-50', share: 'text-emerald-500 bg-emerald-50', wa_send: 'text-emerald-500 bg-emerald-50', bulk_share: 'text-emerald-500 bg-emerald-50', bulk_tag: 'text-purple-500 bg-purple-50', bulk_delete: 'text-red-500 bg-red-50', edit_kw: 'text-amber-500 bg-amber-50', del: 'text-red-500 bg-red-50', role_change: 'text-indigo-500 bg-indigo-50', user_remove: 'text-red-500 bg-red-50', campaign_create: 'text-amber-500 bg-amber-50', campaign_send: 'text-emerald-500 bg-emerald-50' };
  return (
    <div className="space-y-1.5">
      {log.map(l => {
        const Icon = ICONS[l.action] || Clock;
        const color = COLORS[l.action] || 'text-slate-500 bg-slate-50';
        const userName = l.user?.split('@')[0] || 'someone';
        return (
          <div key={l.id} className="flex items-center gap-2.5 py-1.5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}><Icon className="w-3.5 h-3.5" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-xs dark:text-slate-200"><b>{userName}</b> <span className="text-slate-500 dark:text-slate-400">{l.action.replace(/_/g, ' ')}</span> {l.detail && <span className="text-slate-700 dark:text-slate-300">· {l.detail}</span>}</p>
              {!compact && <p className="text-[10px] text-slate-400">{utils.ago(l.ts)}</p>}
            </div>
            {compact && <span className="text-[10px] text-slate-400 flex-shrink-0">{utils.ago(l.ts)}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE CONFIG SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function FirebaseConfig({ onBack }) {
  const { data, persistData, showToast } = useApp();
  const [fb, setFb] = useState(data.firebase || {});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  const save = async () => {
    await persistData({ ...data, firebase: fb });
    showToast('Firebase config saved');
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await firebaseService.testConnection(fb);
      setTestResult({ ok: true, ...r });
      showToast('✓ Firebase config valid');
    } catch (e) {
      const isSandbox = e.message.includes('Network blocked');
      setTestResult({ ok: false, error: e.message, sandbox: isSandbox });
      showToast(e.message, 'error');
    }
    setTesting(false);
  };

  return (
    <div className="p-4 space-y-3 pb-8">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2 dark:text-white"><Zap className="w-5 h-5 text-amber-500" /> Firebase Integration</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Connect Firebase for real-time sync, push notifications, and cloud backup</p>
      </div>

      <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-[11px] text-amber-900 dark:text-amber-200">
        <p className="font-semibold mb-1">🔥 What Firebase enables</p>
        <p>• <b>Firestore:</b> Real-time multi-device sync (operators see each other's uploads instantly)</p>
        <p>• <b>Auth:</b> Sign in with Google (one-tap login for your team)</p>
        <p>• <b>Cloud Functions:</b> Replace Cloudflare Worker (everything in one Google account)</p>
        <p>• <b>FCM:</b> Real push notifications even when app is closed</p>
        <p>• <b>Hosting:</b> Free production deployment</p>
      </div>

      <button onClick={() => setShowGuide(!showGuide)} className="w-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2">
        <FileText className="w-3.5 h-3.5" /> {showGuide ? 'Hide' : 'Show'} Setup Guide
      </button>

      {showGuide && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-300">
          <p className="font-semibold dark:text-white">Where to find these values:</p>
          <p>1. Go to <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">console.firebase.google.com</code></p>
          <p>2. Select your project (or create a new one — same Google account)</p>
          <p>3. Click the <b>⚙️ gear icon → Project Settings</b></p>
          <p>4. Scroll to <b>"Your apps"</b> → if no Web app yet, click <b>{`</>`}</b> to add one</p>
          <p>5. You'll see a <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">firebaseConfig</code> object — copy the values into the fields below</p>
          <p className="text-amber-700 dark:text-amber-300 mt-1">⚠️ The API key here is your <b>public</b> Web API key — safe to use in client code. Firebase security comes from Firestore rules, not from hiding the key.</p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase dark:text-slate-300">Project Credentials</p>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Project ID</label>
          <input value={fb.projectId || ''} onChange={e => setFb({ ...fb, projectId: e.target.value })} placeholder="my-bakery-12345" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Web API Key</label>
          <input value={fb.apiKey || ''} onChange={e => setFb({ ...fb, apiKey: e.target.value })} placeholder="AIzaSy..." className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Auth Domain</label>
          <input value={fb.authDomain || ''} onChange={e => setFb({ ...fb, authDomain: e.target.value })} placeholder="my-bakery-12345.firebaseapp.com" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Storage Bucket</label>
          <input value={fb.storageBucket || ''} onChange={e => setFb({ ...fb, storageBucket: e.target.value })} placeholder="my-bakery-12345.appspot.com" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">App ID</label>
          <input value={fb.appId || ''} onChange={e => setFb({ ...fb, appId: e.target.value })} placeholder="1:1234567890:web:abc123" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white text-sm font-mono" />
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase dark:text-slate-300">Services to Enable</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!fb.useFirestore} onChange={e => setFb({ ...fb, useFirestore: e.target.checked })} className="w-4 h-4" />
          <div className="flex-1"><p className="text-xs font-medium dark:text-slate-200">Firestore Database</p><p className="text-[10px] text-slate-500">Real-time sync across devices</p></div>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!fb.useStorage} onChange={e => setFb({ ...fb, useStorage: e.target.checked })} className="w-4 h-4" />
          <div className="flex-1"><p className="text-xs font-medium dark:text-slate-200">Firebase Storage</p><p className="text-[10px] text-slate-500">Image hosting alternative to Cloudinary</p></div>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!fb.useAuth} onChange={e => setFb({ ...fb, useAuth: e.target.checked })} className="w-4 h-4" />
          <div className="flex-1"><p className="text-xs font-medium dark:text-slate-200">Firebase Auth</p><p className="text-[10px] text-slate-500">Add "Sign in with Google"</p></div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={save} className="bg-blue-600 text-white py-3 rounded-xl font-semibold">Save Config</button>
        <button onClick={testConnection} disabled={testing || !fb.projectId || !fb.apiKey} className="bg-amber-500 text-white py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
          {testing ? <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</> : <><Zap className="w-4 h-4" /> Test</>}
        </button>
      </div>

      {testResult && (
        <div className={`rounded-lg p-3 text-xs ${testResult.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
          {testResult.ok ? <p className="font-semibold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Connection valid</p> : <p className="font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Test failed</p>}
          {testResult.error && <p className="text-[10px] mt-1">{testResult.error}</p>}
          {testResult.sandbox && <p className="text-[10px] mt-1.5">This is the artifact preview sandbox limitation. Your config is saved — it will work once deployed.</p>}
        </div>
      )}

      <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4 space-y-2 text-[11px] text-slate-700 dark:text-slate-300">
        <p className="font-semibold dark:text-white">📌 Activation Status</p>
        <p>• <b>Config storage:</b> ✅ Saved locally (will sync when Firebase SDK is added during deployment)</p>
        <p>• <b>Real activation:</b> needs <code className="bg-white dark:bg-slate-800 px-1 rounded">npm install firebase</code> during deployment</p>
        <p>• <b>What works now:</b> Settings panel, config validation, integration hooks</p>
        <p>• <b>What activates after deploy:</b> Live sync, cloud storage, push notifications</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AI DEMAND FORECAST SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function DemandForecast({ onBack }) {
  const { data, showToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState(null);

  const runForecast = async () => {
    setLoading(true); setError(null);
    try {
      const result = await aiVision.forecast(data);
      if (result.insufficient) setError('Need at least 5 shares to generate forecast. Share more images first!');
      else if (result.error) setError(result.error);
      else setForecast(result);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2 dark:text-white"><Sparkles className="w-5 h-5 text-purple-500" /> AI Demand Forecast</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Claude analyzes your share patterns to predict what's coming</p>
      </div>

      <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-3 text-[11px] text-purple-900 dark:text-purple-200">
        <p>📊 Based on your <b>{(data.shareLog || []).length}</b> shares, <b>{data.images.length}</b> images, and seasonal patterns, Claude generates actionable predictions.</p>
      </div>

      <button onClick={runForecast} disabled={loading} className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing your data...</> : <><Sparkles className="w-4 h-4" /> Generate Forecast</>}
      </button>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-xs">{error}</div>}

      {forecast && (
        <div className="space-y-3">
          {forecast.forecast && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-2">📈 Forecast Overview</p>
              <p className="text-sm dark:text-slate-200">{forecast.forecast}</p>
            </div>
          )}

          {forecast.seasonalAlert && (
            <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">⏰ Seasonal Alert</p>
              <p className="text-sm text-amber-900 dark:text-amber-200">{forecast.seasonalAlert}</p>
            </div>
          )}

          {forecast.predictions?.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-3">📊 Predictions</p>
              <div className="space-y-2">
                {forecast.predictions.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-700">
                    <div className={`text-sm font-bold ${p.expectedChange?.startsWith('+') ? 'text-emerald-600' : 'text-red-600'}`}>{p.expectedChange}</div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold dark:text-slate-100">{p.category}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">{p.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {forecast.actions?.length > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-2">✅ Action Items</p>
              <div className="space-y-1.5">
                {forecast.actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">#{i+1}</span>
                    <p className="text-xs text-emerald-900 dark:text-emerald-200 flex-1">{a}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {forecast.underperforming?.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-2">⚠️ Underperforming Areas</p>
              <div className="space-y-2">
                {forecast.underperforming.map((u, i) => (
                  <div key={i} className="border-l-2 border-amber-400 pl-2.5">
                    <p className="text-sm font-medium dark:text-slate-200">{u.area}</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{u.issue}</p>
                    <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">💡 {u.suggestion}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG SCREEN (full feed)
// ═══════════════════════════════════════════════════════════════════════════
function ActivityLogScreen({ onBack }) {
  const { data } = useApp();
  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 font-medium flex items-center gap-1"><ChevronRight className="w-4 h-4 rotate-180" /> Back</button>
      <div>
        <h2 className="text-xl font-bold dark:text-white">Activity Log</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{(data.activityLog || []).length} events tracked</p>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4">
        <ActivityFeed limit={100} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE VERSIONS — sidebar in ImagePreview
// ═══════════════════════════════════════════════════════════════════════════
function ImageVersionsPanel({ img, onClose }) {
  const { data, persistData, session, showToast, logActivity } = useApp();
  const versions = (data.imageVersions || {})[img.id] || [];
  const similar = useMemo(() => aiVision.findSimilar(img, data.images, 4), [img.id, data.images]);
  const [needsRetake, setNeedsRetake] = useState(img.needsRetake || false);

  const restoreVersion = async (v) => {
    if (!confirm(`Restore "${v.name}" from ${utils.ago(v.ts)}? This creates a new version with current state first.`)) return;
    // Save current as a version
    const currentVersion = {
      id: utils.uid('v'),
      name: img.name,
      keywords: img.keywords,
      ts: Date.now(),
      savedBy: session.email,
      reason: 'auto-saved before restore',
    };
    const updatedVersions = { ...(data.imageVersions || {}), [img.id]: [currentVersion, ...versions] };
    // Restore version's data
    await persistData({
      ...data,
      imageVersions: updatedVersions,
      images: data.images.map(i => i.id === img.id ? { ...i, name: v.name, keywords: v.keywords } : i),
    });
    logActivity('version_restore', `${img.name} → ${utils.ago(v.ts)} version`);
    showToast('Version restored');
    onClose();
  };

  const toggleRetake = async () => {
    setNeedsRetake(!needsRetake);
    await persistData({ ...data, images: data.images.map(i => i.id === img.id ? { ...i, needsRetake: !needsRetake } : i) });
    showToast(!needsRetake ? '📷 Flagged for retake' : 'Retake flag cleared');
  };

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase dark:text-slate-300 flex items-center gap-1">📷 Photo Quality</p>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="checkbox" checked={needsRetake} onChange={toggleRetake} className="w-3.5 h-3.5" />
            <span className="dark:text-slate-300">Needs retake</span>
          </label>
        </div>
        {needsRetake && <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded p-2">⚠️ Flagged for retake — Manager will see this in priority list</p>}
      </div>

      {versions.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
          <p className="text-xs font-semibold uppercase dark:text-slate-300 mb-2 flex items-center gap-1"><Clock className="w-3 h-3" /> History ({versions.length})</p>
          <div className="space-y-1.5">
            {versions.slice(0, 5).map(v => (
              <div key={v.id} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-700 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate dark:text-slate-200">{v.name}</p>
                  <p className="text-[10px] text-slate-500">{v.savedBy?.split('@')[0]} · {utils.ago(v.ts)} · {v.reason}</p>
                </div>
                <button onClick={() => restoreVersion(v)} className="text-[10px] text-blue-600 font-medium px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded">Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {similar.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
          <p className="text-xs font-semibold uppercase dark:text-slate-300 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3 text-purple-500" /> Similar Images</p>
          <div className="grid grid-cols-2 gap-2">
            {similar.map(({ img: simImg, score }) => (
              <div key={simImg.id} className="bg-slate-50 dark:bg-slate-700 rounded-lg overflow-hidden">
                <div className="aspect-square"><LazyImage id={simImg.id} thumbnail={simImg.thumbnail} className="w-full h-full" /></div>
                <div className="p-1.5">
                  <p className="text-[10px] font-medium truncate dark:text-slate-200">{simImg.name}</p>
                  <p className="text-[9px] text-slate-500">{Math.round(score)}% match</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BOTTOM NAV
// ═══════════════════════════════════════════════════════════════════════════
function BottomNav({ activeTab, setActiveTab }) {
  const { t } = useApp();
  const tabs = [
    { id: 'home', l: t.home, i: Home },
    { id: 'search', l: t.search, i: Search },
    { id: 'upload', l: t.upload, i: Upload },
    { id: 'campaigns', l: 'Campaigns', i: Sparkles },
    { id: 'settings', l: t.settings, i: Settings },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 z-30">
      <div className="flex items-center justify-around max-w-md mx-auto">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-0.5 py-2.5 px-2 flex-1 ${activeTab === tab.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>
            <tab.i className={`w-5 h-5 ${activeTab === tab.id ? 'stroke-[2.5]' : ''}`} />
            <span className={`text-[10px] font-medium ${activeTab === tab.id ? 'font-semibold' : ''}`}>{tab.l}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
