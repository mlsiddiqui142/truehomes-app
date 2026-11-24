const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// ─── 1. Inject Review Modal HTML before the toast div ────────────────────────
const REVIEW_MODAL_HTML = `
    <!-- REVIEW MODAL -->
    <div id="reviewModal" class="fixed inset-0 z-50 hidden flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div class="bg-gradient-to-br from-orange-500 to-orange-600 px-6 py-5 flex items-center justify-between">
          <div>
            <h2 class="text-xl font-extrabold text-white">Rate Your Order</h2>
            <p class="text-xs text-orange-100 mt-0.5">Share your experience to help others</p>
          </div>
          <button onclick="closeModal('reviewModal')" class="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="p-6 space-y-5">
          <!-- Food Rating -->
          <div>
            <label class="block text-sm font-extrabold text-slate-800 mb-2">🍔 Food Rating <span class="text-red-500">*</span></label>
            <div class="flex gap-2" id="foodStars">
              ${[1,2,3,4,5].map(n => `<button data-val="${n}" onclick="setReviewStar('food',${n})" class="star-btn text-3xl text-slate-200 hover:text-orange-400 transition" aria-label="${n} star">★</button>`).join('')}
            </div>
          </div>
          <!-- Delivery Rating -->
          <div>
            <label class="block text-sm font-extrabold text-slate-800 mb-2">🛵 Delivery Rating <span class="text-slate-400 font-normal">(optional)</span></label>
            <div class="flex gap-2" id="deliveryStars">
              ${[1,2,3,4,5].map(n => `<button data-val="${n}" onclick="setReviewStar('delivery',${n})" class="star-btn text-3xl text-slate-200 hover:text-orange-400 transition" aria-label="${n} star">★</button>`).join('')}
            </div>
          </div>
          <!-- Comment -->
          <div>
            <label class="block text-sm font-extrabold text-slate-800 mb-2">💬 Comment <span class="text-slate-400 font-normal">(optional)</span></label>
            <textarea id="reviewComment" maxlength="300" rows="3" placeholder="Tell us what you loved (or what could be better)…"
              class="w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-700 focus:outline-none focus:border-orange-400 resize-none"></textarea>
            <p class="text-xs text-slate-400 mt-1 text-right"><span id="reviewCharCount">0</span>/300</p>
          </div>
          <button onclick="submitReview()" class="w-full py-3 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-sm transition">
            Submit Review
          </button>
        </div>
      </div>
    </div>

`;

const TOAST_MARKER = '    <!-- TOAST NOTIFICATION -->';
if (!html.includes(TOAST_MARKER)) {
  console.error('ERROR: Toast marker not found'); process.exit(1);
}
html = html.replace(TOAST_MARKER, REVIEW_MODAL_HTML + TOAST_MARKER);
console.log('✔ Injected review modal HTML');

// ─── 2. Update rating badge in renderRestaurants to show reviewCount ──────────
const OLD_RATING_BADGE = `                <span class="shrink-0 inline-flex items-center gap-1 bg-emerald-600 text-white text-xs font-extrabold px-2 py-0.5 rounded-lg">
                  <i class="fa-solid fa-star text-[10px]"></i> \${escapeHTML(r.rating)}
                </span>`;
const NEW_RATING_BADGE = `                <span class="shrink-0 inline-flex items-center gap-1 bg-emerald-600 text-white text-xs font-extrabold px-2 py-0.5 rounded-lg" title="\${r.reviewCount || 0} reviews">
                  <i class="fa-solid fa-star text-[10px]"></i> \${escapeHTML(r.rating)}\${r.reviewCount ? \`<span class="font-normal opacity-80 text-[10px]">(\${r.reviewCount})</span>\` : ''}
                </span>`;
if (!html.includes(OLD_RATING_BADGE)) {
  console.error('ERROR: rating badge target not found'); process.exit(1);
}
html = html.replace(OLD_RATING_BADGE, NEW_RATING_BADGE);
console.log('✔ Updated rating badge to include reviewCount');

// ─── 3. Auto-open review modal when SSE delivers DELIVERED status ─────────────
const OLD_SSE_DELIVERED = `              if (updated.status === 'DELIVERED') {
                disconnectTrackLiveStream();
              }`;
const NEW_SSE_DELIVERED = `              if (updated.status === 'DELIVERED') {
                disconnectTrackLiveStream();
                if (state.user && state.activeOrder && state.activeOrder.userId && String(state.activeOrder.userId) === String(state.user._id)) {
                  setTimeout(() => openReviewModal(updated.orderCode), 1500);
                }
              }`;
if (!html.includes(OLD_SSE_DELIVERED)) {
  console.error('ERROR: SSE DELIVERED hook target not found'); process.exit(1);
}
html = html.replace(OLD_SSE_DELIVERED, NEW_SSE_DELIVERED);
console.log('✔ Hooked review modal auto-open on SSE DELIVERED');

// ─── 4. Inject review JS functions before closing </script> ──────────────────
const REVIEW_JS = `
      // ═══════════════════════════════════════════════════════════
      // CUSTOMER REVIEWS ENGINE
      // ═══════════════════════════════════════════════════════════
      let _reviewOrderCode = null;
      let _reviewFoodRating = 0;
      let _reviewDeliveryRating = 0;

      function openReviewModal(orderCode) {
        _reviewOrderCode = orderCode;
        _reviewFoodRating = 0;
        _reviewDeliveryRating = 0;
        document.getElementById('reviewComment').value = '';
        document.getElementById('reviewCharCount').textContent = '0';
        renderStars('foodStars', 0);
        renderStars('deliveryStars', 0);
        document.getElementById('reviewModal').classList.remove('hidden');
      }

      function renderStars(containerId, value) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('.star-btn').forEach(btn => {
          const v = Number(btn.dataset.val);
          btn.style.color = v <= value ? '#ea580c' : '#cbd5e1';
        });
      }

      function setReviewStar(type, value) {
        if (type === 'food') {
          _reviewFoodRating = value;
          renderStars('foodStars', value);
        } else {
          _reviewDeliveryRating = value;
          renderStars('deliveryStars', value);
        }
      }

      document.addEventListener('DOMContentLoaded', () => {
        const commentBox = document.getElementById('reviewComment');
        if (commentBox) {
          commentBox.addEventListener('input', () => {
            document.getElementById('reviewCharCount').textContent = commentBox.value.length;
          });
        }
      });

      async function submitReview() {
        if (!_reviewOrderCode) return showToast('No order selected for review');
        if (_reviewFoodRating < 1) return showToast('Please rate the food (1-5 stars)');

        const payload = {
          foodRating: _reviewFoodRating,
          deliveryRating: _reviewDeliveryRating > 0 ? _reviewDeliveryRating : null,
          comment: document.getElementById('reviewComment').value.trim()
        };

        try {
          const headers = { 'Content-Type': 'application/json' };
          if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
          const res = await fetch('/api/orders/' + encodeURIComponent(_reviewOrderCode) + '/review', {
            method: 'POST', headers, body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) return showToast(data.error || 'Review failed');
          closeModal('reviewModal');
          showToast('🌟 Review submitted! Thank you.');
          // Refresh restaurant cards so updated rating is visible
          fetchRestaurants();
        } catch (err) {
          showToast('Network error submitting review');
        }
      }

`;

const SW_MARKER = `  if ('serviceWorker' in navigator)`;
if (!html.includes(SW_MARKER)) {
  console.error('ERROR: SW marker not found'); process.exit(1);
}
html = html.replace(SW_MARKER, REVIEW_JS + '      ' + SW_MARKER.trim());
console.log('✔ Injected review JS functions');

fs.writeFileSync('public/index.html', html, 'utf8');
console.log('✔ Saved public/index.html');
