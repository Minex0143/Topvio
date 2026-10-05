let step = 1;
let selectedType = '';
let structure = {};
let builtType = '';
const imageState = { overview: [], units: {} };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const SQM_PER_SQYD = 0.83612736;
const PRICE_MAX_LAKH = 5000;

function setStep(n) {
  step = n;
  document.querySelectorAll('.wizard-step').forEach(x => x.classList.toggle('active', +x.dataset.step === n));
  document.querySelectorAll('.step-dot').forEach(x => {
    const s = +x.dataset.step;
    x.classList.toggle('active', s === n);
    x.classList.toggle('done', s < n);
  });
  $('prevBtn').disabled = n === 1;
  $('nextBtn').classList.toggle('d-none', n === 8);
  $('publishBtn').classList.toggle('d-none', n !== 8);
  if (n === 3) buildStructure();
  if (n === 8) buildReview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function field(label, html, cls = 'col-md-6') {
  return `<div class="${cls}"><label>${label}</label>${html}</div>`;
}

function selectOptions(values) {
  return values.map(v => `<option value="${v}">${v}</option>`).join('');
}

function unitFields(prefix, title, subtitle = '') {
  return `
    <div class="unit-editor" data-unit="${prefix}">
      <div class="unit-editor-head">
        <div><span class="unit-kicker">UNIT</span><h5>${title}</h5>${subtitle ? `<small>${subtitle}</small>` : ''}</div>
        <span class="unit-index">${prefix.split('_').slice(-1)[0]}</span>
      </div>
      <div class="row g-3">
        ${field('Unit type', `<select class="form-select u-type">${selectOptions(['1 BHK','2 BHK','3 BHK','4 BHK','5 BHK','6 BHK'])}</select>`)}
        ${field('Facing', `<select class="form-select u-facing">${selectOptions(['East','West','North','South'])}</select>`)}
        ${field('Size · sq yd', `<input class="form-control u-yards" type="number" min="0" step="0.01" placeholder="e.g. 150">`)}
        ${field('Size · sq m', `<input class="form-control u-sqm" type="number" step="0.01" readonly placeholder="Auto calculated">`)}
        ${field('Dimensions', `<input class="form-control u-dim" placeholder="Example: 30 × 40 ft">`)}
        <div class="col-12">
          <div class="price-box">
            <div class="price-head"><div><label class="mb-0">Price range</label><small>Drag both handles to set the expected range.</small></div><strong class="price-value">₹0 – ₹0</strong></div>
            <div class="range-wrap">
              <div class="range-track"></div>
              <input class="price-range price-min" type="range" min="0" max="${PRICE_MAX_LAKH}" step="1" value="0" aria-label="Minimum price in lakhs">
              <input class="price-range price-max" type="range" min="0" max="${PRICE_MAX_LAKH}" step="1" value="0" aria-label="Maximum price in lakhs">
            </div>
            <div class="range-labels"><span>₹0</span><span>₹50 Cr</span></div>
            <div class="row g-2 mt-2"><div class="col-6"><input class="form-control form-control-sm pmin-lakh" type="number" min="0" max="${PRICE_MAX_LAKH}" step="1" value="0" placeholder="Min ₹ lakh"></div><div class="col-6"><input class="form-control form-control-sm pmax-lakh" type="number" min="0" max="${PRICE_MAX_LAKH}" step="1" value="0" placeholder="Max ₹ lakh"></div></div>
          </div>
        </div>
        <div class="col-12">
          ${imagePicker('unit', prefix, 'Unit images', 'Add unit photos. Each photo can be replaced or deleted before publishing.')}
        </div>
      </div>
    </div>`;
}

function imagePicker(scope, key, title, hint) {
  const stateKey = scope === 'overview' ? 'overview' : key;
  if (scope === 'unit' && !imageState.units[key]) imageState.units[key] = [];
  return `
    <div class="image-manager" data-image-manager="${scope}" data-image-key="${esc(stateKey)}">
      <div class="image-manager-head"><div><label class="mb-0">${title}</label><small>${hint}</small></div><button type="button" class="btn btn-sm btn-outline-dark image-add" data-scope="${scope}" data-key="${esc(stateKey)}">＋ Add images</button></div>
      <div class="image-grid" data-image-grid="${esc(stateKey)}"></div>
    </div>`;
}

function buildStructure() {
  selectedType = document.querySelector('input[name=ptype]:checked')?.value || selectedType;
  const root = $('structureBuilder');
  if (selectedType && builtType === selectedType && root.children.length) return;
  if (!selectedType) {
    root.innerHTML = '<div class="empty-builder"><div class="builder-icon">⌂</div><h5>Select a property type</h5><p>Go back to Step 2 and choose Individual house, Apartments or Gated community.</p></div>';
    return;
  }

  if (selectedType === 'individual') {
    root.innerHTML = `<div class="builder-toolbar"><div><span class="eyebrow">INDIVIDUAL HOUSE</span><h4>Configure each unit</h4><p>Every unit gets its own type, facing, size, price and photo gallery.</p></div><div class="count-control"><label>Number of units</label><select id="unitCount" class="form-select">${Array.from({length:100},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div></div><div id="unitList"></div>`;
    const c = $('unitCount');
    c.value = Math.min(100, Math.max(1, Object.keys(imageState.units).filter(k => k.startsWith('individual_')).length || 1));
    c.addEventListener('change', () => renderIndividual(+c.value));
    renderIndividual(+c.value);
  }

  if (selectedType === 'apartment') {
    root.innerHTML = `<div class="builder-toolbar"><div><span class="eyebrow">APARTMENTS</span><h4>Build floor by floor</h4><p>Set the number of units on every floor, then configure each unit independently.</p></div><div class="count-control"><label>Number of floors</label><select id="floorCount" class="form-select">${Array.from({length:40},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div></div><div id="floorList"></div>`;
    const c = $('floorCount');
    const existingFloors = Object.keys(imageState.units).filter(k => k.startsWith('floor_')).map(k => +k.split('_')[1]).filter(Boolean);
    c.value = Math.min(40, Math.max(1, Math.max(...existingFloors, 1)));
    c.addEventListener('change', () => renderApartmentFloors(+c.value));
    renderApartmentFloors(+c.value);
  }

  if (selectedType === 'gated') {
    root.innerHTML = `<div class="builder-toolbar"><div><span class="eyebrow">GATED COMMUNITY</span><h4>Configure every apartment</h4><p>Each apartment can have a different number of floors and each floor can have a different number of units.</p></div><div class="count-control"><label>Number of apartments</label><select id="aptCount" class="form-select">${Array.from({length:100},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div></div><div id="apartmentList"></div>`;
    const c = $('aptCount');
    c.addEventListener('change', () => renderGated(+c.value));
    c.value = 1;
    renderGated(+c.value);
  }
  builtType = selectedType;
}

function renderIndividual(n) {
  const old = [...document.querySelectorAll('#unitList .unit-editor')].map(e => ({key:e.dataset.unit, data:readUnit(e)}));
  $('unitList').innerHTML = Array.from({length:n}, (_,i) => unitFields(`individual_${i+1}`, `Unit ${i+1}`)).join('');
  hydrateImagesAndFields(old);
}

function renderApartmentFloors(n) {
  const old = collectApartmentDraft();
  $('floorList').innerHTML = Array.from({length:n}, (_,i) => {
    const floorNo = i + 1;
    const count = old[floorNo]?.number_units || 1;
    return `<div class="floor-card" data-floor="${floorNo}"><div class="floor-head"><div><span class="floor-number">${floorNo}</span><div><b>Floor ${floorNo}</b><small>Configure units on this floor</small></div></div><div class="count-control compact"><label>Units on floor</label><select class="floor-unit-count" data-floor="${floorNo}">${Array.from({length:100},(_,u)=>`<option value="${u+1}" ${u+1===count?'selected':''}>${u+1}</option>`).join('')}</select></div></div><div class="floor-units">${Array.from({length:count},(_,u)=>unitFields(`floor_${floorNo}_unit_${u+1}`, `Unit ${u+1}`, `Floor ${floorNo}`)).join('')}</div></div>`;
  }).join('');
  document.querySelectorAll('.floor-unit-count').forEach(sel => sel.addEventListener('change', e => renderFloorUnits(+e.target.dataset.floor, +e.target.value)));
  const oldUnits = Object.values(old).flatMap(x => x.units || []).map(data => ({key:data.label, data}));
  hydrateImagesAndFields(oldUnits);
}

function renderFloorUnits(floorNo, count) {
  const floor = document.querySelector(`.floor-card[data-floor="${floorNo}"]`);
  const old = [...floor.querySelectorAll('.unit-editor')].map(e => ({key:e.dataset.unit, data:readUnit(e)}));
  floor.querySelector('.floor-units').innerHTML = Array.from({length:count},(_,u)=>unitFields(`floor_${floorNo}_unit_${u+1}`, `Unit ${u+1}`, `Floor ${floorNo}`)).join('');
  hydrateImagesAndFields(old);
}

function renderGated(apartmentCount) {
  const old = collectGatedDraft();
  $('apartmentList').innerHTML = Array.from({length:apartmentCount}, (_,ai) => {
    const apartmentNo = ai + 1;
    const floorCount = old[apartmentNo]?.length || 1;
    return `<div class="apartment-card" data-apartment="${apartmentNo}"><div class="apartment-head"><div><span class="eyebrow">APARTMENT ${apartmentNo}</span><h4>Apartment ${apartmentNo}</h4><p>Configure floors and units independently.</p></div><div class="count-control"><label>Number of floors</label><select class="apartment-floor-count" data-apartment="${apartmentNo}">${Array.from({length:40},(_,f)=>`<option value="${f+1}" ${f+1===floorCount?'selected':''}>${f+1}</option>`).join('')}</select></div></div><div class="gated-floor-list">${renderGatedFloorsHtml(apartmentNo, floorCount, old[apartmentNo])}</div></div>`;
  }).join('');
  document.querySelectorAll('.apartment-floor-count').forEach(sel => sel.addEventListener('change', e => renderGatedFloors(+e.target.dataset.apartment, +e.target.value)));
  document.querySelectorAll('.gated-floor-unit-count').forEach(sel => sel.addEventListener('change', e => renderGatedFloorUnits(+e.target.dataset.apartment, +e.target.dataset.floor, +e.target.value)));
  const oldUnits = Object.values(old).flatMap(floors => floors.flatMap(f => f.units || [])).map(data => ({key:data.label, data}));
  hydrateImagesAndFields(oldUnits);
}

function renderGatedFloorsHtml(apartmentNo, floorCount, oldApartment = []) {
  return Array.from({length:floorCount}, (_,fi) => {
    const floorNo = fi + 1;
    const previous = oldApartment?.find(x => x.floor === floorNo);
    const count = previous?.number_units || 1;
    return `<div class="floor-card" data-apartment="${apartmentNo}" data-floor="${floorNo}"><div class="floor-head"><div><span class="floor-number">${floorNo}</span><div><b>Floor ${floorNo}</b><small>Units on this floor</small></div></div><div class="count-control compact"><label>Units on floor</label><select class="gated-floor-unit-count" data-apartment="${apartmentNo}" data-floor="${floorNo}">${Array.from({length:100},(_,u)=>`<option value="${u+1}" ${u+1===count?'selected':''}>${u+1}</option>`).join('')}</select></div></div><div class="floor-units">${Array.from({length:count},(_,u)=>unitFields(`apartment_${apartmentNo}_floor_${floorNo}_unit_${u+1}`, `Unit ${u+1}`, `Apartment ${apartmentNo} · Floor ${floorNo}`)).join('')}</div></div>`;
  }).join('');
}

function renderGatedFloors(apartmentNo, floorCount) {
  const apartment = document.querySelector(`.apartment-card[data-apartment="${apartmentNo}"]`);
  const old = collectGatedDraft()[apartmentNo] || [];
  apartment.querySelector('.gated-floor-list').innerHTML = renderGatedFloorsHtml(apartmentNo, floorCount, old);
  apartment.querySelectorAll('.gated-floor-unit-count').forEach(sel => sel.addEventListener('change', e => renderGatedFloorUnits(+e.target.dataset.apartment, +e.target.dataset.floor, +e.target.value)));
  const oldUnits = old.flatMap(f => f.units || []).map(data => ({key:data.label, data}));
  hydrateImagesAndFields(oldUnits);
}

function renderGatedFloorUnits(apartmentNo, floorNo, count) {
  const floor = document.querySelector(`.floor-card[data-apartment="${apartmentNo}"][data-floor="${floorNo}"]`);
  const old = [...floor.querySelectorAll('.unit-editor')].map(e => ({key:e.dataset.unit, data:readUnit(e)}));
  floor.querySelector('.floor-units').innerHTML = Array.from({length:count},(_,u)=>unitFields(`apartment_${apartmentNo}_floor_${floorNo}_unit_${u+1}`, `Unit ${u+1}`, `Apartment ${apartmentNo} · Floor ${floorNo}`)).join('');
  hydrateImagesAndFields(old);
}

function collectApartmentDraft() {
  const result = {};
  document.querySelectorAll('#floorList .floor-card').forEach(floor => {
    const no = +floor.dataset.floor;
    result[no] = {number_units: floor.querySelector('.floor-unit-count').value, units:[...floor.querySelectorAll('.unit-editor')].map(readUnit)};
  });
  return result;
}

function collectGatedDraft() {
  const result = {};
  document.querySelectorAll('#apartmentList .apartment-card').forEach(apartment => {
    const no = +apartment.dataset.apartment;
    result[no] = [...apartment.querySelectorAll(':scope > .gated-floor-list > .floor-card')].map(floor => ({
      floor:+floor.dataset.floor,
      number_units:+floor.querySelector('.gated-floor-unit-count').value,
      units:[...floor.querySelectorAll('.unit-editor')].map(readUnit)
    }));
  });
  return result;
}

function readUnit(e) {
  if (!e) return {};
  const minLakh = Number(e.querySelector('.pmin-lakh')?.value || 0);
  const maxLakh = Number(e.querySelector('.pmax-lakh')?.value || 0);
  return {
    label:e.dataset.unit,
    type:e.querySelector('.u-type')?.value || '',
    facing:e.querySelector('.u-facing')?.value || '',
    size_yards:e.querySelector('.u-yards')?.value || '',
    size_sqm:e.querySelector('.u-sqm')?.value || '',
    dimensions:e.querySelector('.u-dim')?.value || '',
    pricing_min:minLakh * 100000,
    pricing_max:maxLakh * 100000,
    pricing_min_lakh:minLakh,
    pricing_max_lakh:maxLakh
  };
}

function readUnitByKey(key) {
  const e = document.querySelector(`.unit-editor[data-unit="${CSS.escape(key)}"]`);
  return e ? readUnit(e) : {};
}

function collectStructure() {
  if (selectedType === 'individual') {
    const units = [...document.querySelectorAll('#unitList .unit-editor')].map(readUnit);
    return {number_units:units.length, units};
  }
  if (selectedType === 'apartment') {
    const floors = [...document.querySelectorAll('#floorList .floor-card')].map(floor => ({
      floor:+floor.dataset.floor,
      number_units:+floor.querySelector('.floor-unit-count').value,
      units:[...floor.querySelectorAll('.unit-editor')].map(readUnit)
    }));
    return {number_floors:floors.length, floors};
  }
  const apartments = [...document.querySelectorAll('#apartmentList .apartment-card')].map(apartment => ({
    apartment:+apartment.dataset.apartment,
    number_floors:+apartment.querySelector('.apartment-floor-count').value,
    floors:[...apartment.querySelectorAll(':scope > .gated-floor-list > .floor-card')].map(floor => ({
      floor:+floor.dataset.floor,
      number_units:+floor.querySelector('.gated-floor-unit-count').value,
      units:[...floor.querySelectorAll('.unit-editor')].map(readUnit)
    }))
  }));
  return {number_apartments:apartments.length, apartments};
}

function hydrateImagesAndFields(oldUnits = []) {
  oldUnits.forEach(item => {
    const target = document.querySelector(`.unit-editor[data-unit="${CSS.escape(item.key)}"]`);
    if (!target) return;
    setUnitFields(target, item.data);
  });
  document.querySelectorAll('.unit-editor').forEach(editor => {
    const key = editor.dataset.unit;
    if (!imageState.units[key]) imageState.units[key] = [];
    renderImageGrid(key);
    bindPrice(editor);
    bindSize(editor);
  });
  renderImageGrid('overview');
}

function setUnitFields(editor, data) {
  if (!data) return;
  const type = editor.querySelector('.u-type');
  const facing = editor.querySelector('.u-facing');
  const yards = editor.querySelector('.u-yards');
  const sqm = editor.querySelector('.u-sqm');
  const dim = editor.querySelector('.u-dim');
  if (type && data.type) type.value = data.type;
  if (facing && data.facing) facing.value = data.facing;
  if (yards) yards.value = data.size_yards || '';
  if (sqm) sqm.value = data.size_sqm || '';
  if (dim) dim.value = data.dimensions || '';
  const min = editor.querySelector('.pmin-lakh');
  const max = editor.querySelector('.pmax-lakh');
  if (min) min.value = data.pricing_min_lakh ?? (Number(data.pricing_min || 0) / 100000);
  if (max) max.value = data.pricing_max_lakh ?? (Number(data.pricing_max || 0) / 100000);
}

function bindSize(editor) {
  const yards = editor.querySelector('.u-yards');
  const sqm = editor.querySelector('.u-sqm');
  if (!yards || !sqm || yards.dataset.bound) return;
  yards.dataset.bound = '1';
  const convert = () => {
    const value = Number(yards.value);
    sqm.value = value > 0 ? (value * SQM_PER_SQYD).toFixed(2) : '';
  };
  yards.addEventListener('input', convert);
}

function bindPrice(editor) {
  const minRange = editor.querySelector('.price-min');
  const maxRange = editor.querySelector('.price-max');
  const minInput = editor.querySelector('.pmin-lakh');
  const maxInput = editor.querySelector('.pmax-lakh');
  if (!minRange || !maxRange || minRange.dataset.bound) return;
  minRange.dataset.bound = '1';
  const update = source => {
    let min = Number(minRange.value);
    let max = Number(maxRange.value);
    if (source === 'min' && min > max) max = min;
    if (source === 'max' && max < min) min = max;
    min = Math.max(0, Math.min(PRICE_MAX_LAKH, min));
    max = Math.max(0, Math.min(PRICE_MAX_LAKH, max));
    minRange.value = min; maxRange.value = max; minInput.value = min; maxInput.value = max;
    const pctMin = (min / PRICE_MAX_LAKH) * 100;
    const pctMax = (max / PRICE_MAX_LAKH) * 100;
    const track = editor.querySelector('.range-track');
    track.style.setProperty('--range-start', `${pctMin}%`);
    track.style.setProperty('--range-end', `${pctMax}%`);
    editor.querySelector('.price-value').textContent = `${formatPrice(min)} – ${formatPrice(max)}`;
  };
  minRange.addEventListener('input', () => update('min'));
  maxRange.addEventListener('input', () => update('max'));
  minInput.addEventListener('input', () => { minRange.value = minInput.value || 0; update('min'); });
  maxInput.addEventListener('input', () => { maxRange.value = maxInput.value || 0; update('max'); });
  update();
}

function formatPrice(lakh) {
  const value = Number(lakh || 0);
  if (value >= 100) return `₹${(value / 100).toFixed(value % 100 ? 2 : 0)} Cr`;
  return `₹${value.toLocaleString('en-IN')} L`;
}

function renderImageGrid(key) {
  const grid = document.querySelector(`[data-image-grid="${CSS.escape(key)}"]`);
  if (!grid) return;
  const files = key === 'overview' ? imageState.overview : (imageState.units[key] || []);
  grid.innerHTML = files.map((file, index) => {
    const url = URL.createObjectURL(file);
    return `<div class="image-card"><img src="${url}" alt="${esc(file.name)}"><div class="image-card-body"><span title="${esc(file.name)}">${esc(file.name)}</span><div class="image-actions"><button type="button" class="btn btn-sm btn-light image-replace" data-key="${esc(key)}" data-index="${index}">Replace</button><button type="button" class="btn btn-sm btn-outline-danger image-delete" data-key="${esc(key)}" data-index="${index}">Delete</button></div></div></div>`;
  }).join('');
  if (!files.length) grid.innerHTML = '<div class="image-empty">No images selected yet.</div>';
}

function getFiles(key) { return key === 'overview' ? imageState.overview : (imageState.units[key] || []); }
function setFiles(key, files) { if (key === 'overview') imageState.overview = files; else imageState.units[key] = files; renderImageGrid(key); }

function addFiles(key, files) {
  const current = getFiles(key);
  const incoming = [...files].filter(f => f.type.startsWith('image/'));
  setFiles(key, [...current, ...incoming]);
}

function replaceFile(key, index, file) {
  if (!file || !file.type.startsWith('image/')) return;
  const files = getFiles(key).slice();
  files[index] = file;
  setFiles(key, files);
}

function removeFile(key, index) {
  const files = getFiles(key).slice();
  files.splice(index, 1);
  setFiles(key, files);
}

function chooseImage(key, replaceIndex = null) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.multiple = replaceIndex === null;
  input.onchange = () => {
    if (replaceIndex === null) addFiles(key, input.files);
    else replaceFile(key, replaceIndex, input.files[0]);
  };
  input.click();
}

function validateStructure() {
  if (selectedType === 'individual') {
    const units = [...document.querySelectorAll('#unitList .unit-editor')];
    return units.length > 0 && units.every(hasCompleteUnit);
  }
  if (selectedType === 'apartment') {
    const floors = [...document.querySelectorAll('#floorList .floor-card')];
    return floors.length > 0 && floors.every(f => f.querySelectorAll('.unit-editor').length > 0 && [...f.querySelectorAll('.unit-editor')].every(hasCompleteUnit));
  }
  const apartments = [...document.querySelectorAll('#apartmentList .apartment-card')];
  return apartments.length > 0 && apartments.every(a => [...a.querySelectorAll(':scope > .gated-floor-list > .floor-card')].every(f => f.querySelectorAll('.unit-editor').length > 0 && [...f.querySelectorAll('.unit-editor')].every(hasCompleteUnit)));
}

function hasCompleteUnit(e) {
  const u = readUnit(e);
  return !!u.type && !!u.facing && Number(u.size_yards) > 0 && !!u.dimensions && Number(u.pricing_min_lakh) >= 0 && Number(u.pricing_max_lakh) >= Number(u.pricing_min_lakh);
}

function pruneImageState() {
  const active = new Set([...document.querySelectorAll('.unit-editor')].map(e => e.dataset.unit));
  Object.keys(imageState.units).forEach(key => { if (!active.has(key)) delete imageState.units[key]; });
}

function buildReview() {
  structure = collectStructure();
  const type = document.querySelector('input[name=ptype]:checked')?.value || '';
  let units = 0, floors = 0;
  if (type === 'individual') units = structure.units.length;
  if (type === 'apartment') { floors = structure.floors.length; units = structure.floors.reduce((s,f)=>s+f.units.length,0); }
  if (type === 'gated') { floors = structure.apartments.reduce((s,a)=>s+a.floors.length,0); units = structure.apartments.reduce((s,a)=>s+a.floors.reduce((x,f)=>x+f.units.length,0),0); }
  $('reviewSummary').innerHTML = `<div class="review-grid"><div class="review-item"><small>Owner</small><b>${esc($('ownerName').value)}</b><span>${esc($('ownerEmail').value)} · ${esc($('ownerContact').value)}</span></div><div class="review-item"><small>Property</small><b>${esc($('propertyName').value)}</b><span>${esc($('propertyAddress').value)}</span></div><div class="review-item"><small>Structure</small><b>${esc(type)}</b><span>${floors ? `${floors} floor${floors>1?'s':''} · ` : ''}${units} unit${units!==1?'s':''}</span></div><div class="review-item"><small>Construction</small><b>${$('constructionCompleted').checked?'Completed':'Under construction'}</b><span>${esc($('constructionStart').value)} → ${esc($('constructionEnd').value)}</span></div><div class="review-item"><small>Overview photos</small><b>${imageState.overview.length}</b><span>Images ready to publish</span></div></div>`;
}

$('overviewImages')?.addEventListener('change', e => { addFiles('overview', e.target.files); e.target.value = ''; });

document.addEventListener('click', e => {
  const add = e.target.closest('.image-add');
  if (add) { chooseImage(add.dataset.key); return; }
  const replace = e.target.closest('.image-replace');
  if (replace) { chooseImage(replace.dataset.key, +replace.dataset.index); return; }
  const del = e.target.closest('.image-delete');
  if (del) { removeFile(del.dataset.key, +del.dataset.index); }
});

document.querySelectorAll('input[name=ptype]').forEach(r => r.addEventListener('change', () => { selectedType = r.value; builtType = ''; }));
$('nextBtn').addEventListener('click', () => {
  if (step === 1) {
    const required = ['ownerName','ownerContact','ownerEmail','ownerAadhar','propertyName','propertyAddress','mapLocation'];
    if (!required.every(id => $(id).value.trim())) { alert('Please complete all required owner and property fields.'); return; }
  }
  if (step === 2 && !document.querySelector('input[name=ptype]:checked')) { alert('Select a property type.'); return; }
  if (step === 3) {
    if (!validateStructure()) { alert('Please complete every floor and unit: type, facing, size, dimensions and price range.'); return; }
  }
  if (step === 5 && (!$('constructionStart').value || !$('constructionEnd').value)) { alert('Enter construction dates.'); return; }
  if (step === 7 && imageState.overview.length === 0) { alert('Upload at least one property overview image.'); return; }
  if (step < 8) setStep(step + 1);
});
$('prevBtn').addEventListener('click', () => { if (step > 1) setStep(step - 1); });
$('constructionCompleted').addEventListener('change', () => { $('constructionEndLabel').textContent = $('constructionCompleted').checked ? 'Completed · month & year' : 'Expected completion · month & year'; });

$('propertyForm').addEventListener('submit', async e => {
  e.preventDefault();
  pruneImageState();
  structure = collectStructure();
  const form = new FormData();
  const payload = {
    owner:{name:$('ownerName').value,contact:$('ownerContact').value,email:$('ownerEmail').value,aadhar:$('ownerAadhar').value},
    property:{name:$('propertyName').value,address:$('propertyAddress').value,map_location:$('mapLocation').value,latitude:$('latitude').value,longitude:$('longitude').value},
    property_type:selectedType,
    structure,
    documents:$('documents').value,
    construction:{completed:$('constructionCompleted').checked,start:$('constructionStart').value,end:$('constructionEnd').value},
    important_details:$('importantDetails').value,
    publish:true
  };
  form.append('payload', JSON.stringify(payload));
  imageState.overview.forEach((file,i) => form.append(`overview_${i}`, file));
  Object.entries(imageState.units).forEach(([key, files]) => files.forEach((file,i) => form.append(`unit_${key}_${i}`, file)));
  $('publishBtn').disabled = true; $('publishBtn').textContent = 'Publishing…';
  try {
    const res = await fetch(location.href, {method:'POST', body:form});
    const data = await res.json().catch(() => ({ok:false,error:'Unexpected server response'}));
    if (data.ok) location.href = data.redirect;
    else throw new Error(data.error || 'Could not save property.');
  } catch (err) {
    alert(err.message);
    $('publishBtn').disabled = false; $('publishBtn').textContent = '✓ List property';
  }
});

setStep(1);
