import { useState, useEffect, useLayoutEffect, useMemo, useRef, Fragment } from "react";
import {
  Plus,
  X,
  Phone,
  Pencil,
  Trash2,
  Calendar as CalendarIcon,
  List as ListIcon,
  Home,
  ChevronLeft,
  ChevronRight,
  Leaf,
  Menu,
  AlertCircle,
  MapPin,
  Percent,
  Download,
  Upload,
  FileText,
  ExternalLink,
  Camera,
  Lock,
  LogOut,
} from "lucide-react";
import { supabase } from "./supabaseClient";

// E-mail fixo usado internamente para o login único do Mirante.
// Todos que sabem a senha entram com essa mesma conta.
const SHARED_LOGIN_EMAIL = "bitridedestinos@gmail.com";

const DEFAULT_PROPERTY_NAMES = [
  "Sítio Wanderlust",
  "Chalé do Riacho",
  "Recanto da Cachoeira",
  "Chácara da Bisa",
  "Sítio do Ipê",
  "Pousada Canto Bonito",
  "Sítio Herman – Natureza Viva",
];

const DEFAULT_PROPERTIES = DEFAULT_PROPERTY_NAMES.map((name, i) => ({
  id: `prop-${i}`,
  name,
  hostName: "",
  hostPayoutWeekday: "",
  hostPayoutWeekend: "",
  payoutMode: "simples", // "simples" | "faixas" | "adicional"
  payoutTiers: [], // [{ maxGuests, weekday, weekend }]
  payoutIncludedGuests: "",
  payoutExtraPerGuest: "",
  breakfastFee: "", // R$ por diária; vazio = não oferece café
  breakfastUnit: "pessoa", // "pessoa" | "casal"
  cleaningFee: "",
  petFeePerDay: "",
  spaFeePerDay: "", // R$ por diária; vazio = não oferece spa
  mapsLink: "",
  airbnbLink: "",
  bookingLink: "",
  photo: "", // miniatura base64 (comprimida)
}));

const TOKENS = {
  ink: "#23241F",
  pine: "#3D453D",
  pineDark: "#2B322B",
  headerBg: "#3D453D",
  river: "#63706B",
  clay: "#B08D6E",
  clayLight: "#DED1BE",
  sand: "#EAE5D8",
  cream: "#F8F6EF",
  moss: "#8A9182",
  danger: "#A6432F",
};

const CHANNELS = [
  { id: "airbnb", label: "Airbnb", defaultRate: 0.15, color: "#B08D6E" },
  { id: "booking", label: "Booking.com", defaultRate: 0.18, color: "#63706B" },
  { id: "direta", label: "Reserva direta", defaultRate: 0, color: "#8A9182" },
];

function channelInfo(id) {
  return CHANNELS.find((c) => c.id === id) || null;
}

function channelLabel(id) {
  return channelInfo(id)?.label || "Canal não definido";
}

function defaultPlatformRate(id) {
  return channelInfo(id)?.defaultRate ?? 0;
}

// O valor digitado na reserva já é o valor final cobrado do hóspede (com
// eventual desconto embutido). O % de desconto serve apenas para reduzir o
// repasse sugerido ao anfitrião — nunca desconta o valor recebido de novo.
function effectiveValue(r) {
  return Number(r.value) || 0;
}

// Garante que o link tenha protocolo; sem isso o navegador trata como
// endereço relativo e o atalho não abre.
function normalizeUrl(url) {
  const u = (url || "").trim();
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : "https://" + u;
}

// Comprime uma imagem para miniatura quadrada em base64 (JPEG pequeno),
// para caber no armazenamento sem pesar. Corta centralizado.
function fileToThumb(file, size = 144) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL("image/jpeg", 0.75));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function hasFixedPayout(r) {
  return r.hostPayout !== "" && r.hostPayout !== undefined && r.hostPayout !== null;
}

// Noites de sexta e sábado usam o valor de fim de semana.
function isWeekendNight(iso) {
  const d = new Date(iso + "T00:00:00").getDay();
  return d === 5 || d === 6;
}

// Diárias (semana/fds) do imóvel conforme o modo de repasse e nº de hóspedes.
// Retorna { weekday, weekend } ou null se não há valores configurados.
function payoutRatesFor(property, guests) {
  const mode = property.payoutMode || "simples";
  const g = Number(guests) || 0;

  if (mode === "faixas" && Array.isArray(property.payoutTiers) && property.payoutTiers.length > 0) {
    const tiers = [...property.payoutTiers]
      .filter((t) => t && t.maxGuests !== "" && t.maxGuests !== undefined)
      .sort((a, b) => Number(a.maxGuests) - Number(b.maxGuests));
    if (tiers.length === 0) return null;
    // Sem nº de hóspedes informado, usa a primeira faixa (menor).
    const tier =
      g > 0
        ? tiers.find((t) => g <= Number(t.maxGuests)) || tiers[tiers.length - 1]
        : tiers[0];
    return { weekday: tier.weekday, weekend: tier.weekend };
  }

  const wk = property.hostPayoutWeekday;
  const we = property.hostPayoutWeekend;
  if ((wk === "" || wk === undefined) && (we === "" || we === undefined)) return null;

  if (mode === "adicional") {
    const included = Number(property.payoutIncludedGuests) || 0;
    const extraRate = Number(property.payoutExtraPerGuest) || 0;
    const extras = included > 0 && g > included ? (g - included) * extraRate : 0;
    const wkN = wk === "" || wk === undefined ? Number(we) || 0 : Number(wk) || 0;
    const weN = we === "" || we === undefined ? Number(wk) || 0 : Number(we) || 0;
    return { weekday: wkN + extras, weekend: weN + extras };
  }

  return { weekday: wk, weekend: we };
}

// Repasse sugerido: soma das diárias do imóvel entre check-in e check-out,
// escolhendo os valores conforme o nº de hóspedes (faixas ou adicional).
// O desconto da reserva (fração, ex: 0.1) é aplicado nas diárias do repasse
// — o dono absorve o mesmo percentual. Café da manhã soma por fora, sem desconto.
function suggestedHostPayout(property, checkIn, checkOut, guests, breakfast, discount, pets, spa) {
  if (!property || !checkIn || !checkOut || checkOut <= checkIn) return null;
  const rates = payoutRatesFor(property, guests);
  if (!rates) return null;
  const wk = rates.weekday;
  const we = rates.weekend;
  if ((wk === "" || wk === undefined) && (we === "" || we === undefined)) return null;
  let total = 0;
  let nights = 0;
  let cur = checkIn;
  while (cur < checkOut) {
    const useWe = isWeekendNight(cur);
    const rate = useWe ? (we === "" || we === undefined ? wk : we) : (wk === "" || wk === undefined ? we : wk);
    total += Number(rate) || 0;
    nights += 1;
    cur = addDaysISO(cur, 1);
  }
  const d = Number(discount) || 0;
  if (d > 0 && d <= 1) total = total * (1 - d);
  // Taxa de limpeza: valor único por estadia (não multiplica por noites),
  // somado ao repasse sem sofrer desconto.
  if (property.cleaningFee !== "" && property.cleaningFee !== undefined && property.cleaningFee !== null) {
    total += Number(property.cleaningFee) || 0;
  }
  if (breakfast && property.breakfastFee !== "" && property.breakfastFee !== undefined) {
    const fee = Number(property.breakfastFee) || 0;
    const g = Math.max(Number(guests) || 1, 1);
    const units = property.breakfastUnit === "casal" ? Math.ceil(g / 2) : g;
    total += fee * units * nights;
  }
  // Taxa de pet: por pet, por diária, sem desconto.
  const petCount = Number(pets) || 0;
  if (petCount > 0 && property.petFeePerDay !== "" && property.petFeePerDay !== undefined && property.petFeePerDay !== null) {
    total += (Number(property.petFeePerDay) || 0) * petCount * nights;
  }
  // Taxa de spa: por diária quando usado, sem desconto.
  if (spa && property.spaFeePerDay !== "" && property.spaFeePerDay !== undefined && property.spaFeePerDay !== null) {
    total += (Number(property.spaFeePerDay) || 0) * nights;
  }
  return total;
}

// Valor que entra na sua conta nessa reserva.
function receivedForReservation(r) {
  if (r.channel === "airbnb" || r.channel === "booking") {
    return Number(r.netReceived) || 0;
  }
  return effectiveValue(r);
}

// Quanto vai para o dono. null = Airbnb paga o dono diretamente.
function payoutForReservation(r) {
  if (r.channel === "airbnb") return null;
  if (hasFixedPayout(r)) return Number(r.hostPayout) || 0;
  return receivedForReservation(r) - earningsForReservation(r);
}

function earningsForReservation(r) {
  if (r.channel === "airbnb") {
    return Number(r.netReceived) || 0;
  }
  const base = receivedForReservation(r);
  if (hasFixedPayout(r)) {
    return base - (Number(r.hostPayout) || 0);
  }
  return base * (Number(r.commissionRate) || 0);
}

function genId() {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Sempre usa os componentes de data LOCAIS (nunca toISOString/UTC), para não
// desalinhar o calendário dependendo do horário/fuso em que o app é usado.
function dateToISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return dateToISO(new Date());
}

function fmtDateBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn + "T00:00:00");
  const b = new Date(checkOut + "T00:00:00");
  const diff = Math.round((b - a) / 86400000);
  return diff > 0 ? diff : 0;
}

function getMonthGrid(refDate) {
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function dateInReservation(date, res) {
  const iso = dateToISO(date);
  return iso >= res.checkIn && iso < res.checkOut;
}

// Preenche campos que podem faltar em imóveis salvos por versões antigas do
// app (tanto vindos do banco quanto de um backup importado), e migra o campo
// antigo "hostPayout" (único) para "hostPayoutWeekday". Usada tanto no
// carregamento inicial quanto na importação de backup, para que os dois
// caminhos fiquem sempre consistentes.
function migratePropertiesList(rawProps) {
  const list = rawProps && rawProps.length ? rawProps : DEFAULT_PROPERTIES;
  return list.map((p, i) => {
    if (typeof p === "string") {
      return {
        id: `prop-${i}-${genId()}`,
        name: p,
        hostName: "",
        hostPayoutWeekday: "",
        hostPayoutWeekend: "",
        payoutMode: "simples",
        payoutTiers: [],
        payoutIncludedGuests: "",
        payoutExtraPerGuest: "",
        breakfastFee: "",
        breakfastUnit: "pessoa",
        cleaningFee: "",
        petFeePerDay: "",
        spaFeePerDay: "",
        mapsLink: "",
        airbnbLink: "",
        bookingLink: "",
        photo: "",
      };
    }
    const base = {
      id: p.id || `prop-${i}-${genId()}`,
      hostName: "",
      hostPayoutWeekday: "",
      hostPayoutWeekend: "",
      payoutMode: "simples",
      payoutTiers: [],
      payoutIncludedGuests: "",
      payoutExtraPerGuest: "",
      breakfastFee: "",
      breakfastUnit: "pessoa",
      cleaningFee: "",
      petFeePerDay: "",
      spaFeePerDay: "",
      mapsLink: "",
      airbnbLink: "",
      bookingLink: "",
      photo: "",
      ...p,
    };
    // migração: imóveis antigos tinham um único "hostPayout"
    if (
      base.hostPayout !== undefined &&
      base.hostPayout !== "" &&
      base.hostPayoutWeekday === ""
    ) {
      base.hostPayoutWeekday = base.hostPayout;
    }
    delete base.hostPayout;
    return base;
  });
}

// ---------------------------------------------------------------------
// Mapeamento entre o formato usado na tela (camelCase, "" para vazio) e
// as tabelas normalizadas do Supabase (snake_case, null para vazio).
// Isso mantém todo o resto do app (telas, cálculos, filtros) inalterado —
// só a gravação/leitura muda de "1 JSON gigante" para "linhas de tabela".
// ---------------------------------------------------------------------
function numOrNull(v) {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function nullToEmpty(v) {
  return v === null || v === undefined ? "" : v;
}

function propertyToRow(p) {
  return {
    id: p.id,
    name: p.name,
    host_name: p.hostName || "",
    host_payout_weekday: numOrNull(p.hostPayoutWeekday),
    host_payout_weekend: numOrNull(p.hostPayoutWeekend),
    payout_mode: p.payoutMode || "simples",
    payout_tiers: p.payoutTiers || [],
    payout_included_guests: numOrNull(p.payoutIncludedGuests),
    payout_extra_per_guest: numOrNull(p.payoutExtraPerGuest),
    breakfast_fee: numOrNull(p.breakfastFee),
    breakfast_unit: p.breakfastUnit || "pessoa",
    cleaning_fee: numOrNull(p.cleaningFee),
    pet_fee_per_day: numOrNull(p.petFeePerDay),
    spa_fee_per_day: numOrNull(p.spaFeePerDay),
    maps_link: p.mapsLink || "",
    airbnb_link: p.airbnbLink || "",
    booking_link: p.bookingLink || "",
    photo: p.photo || "",
  };
}

function rowToProperty(row) {
  return {
    id: row.id,
    name: row.name,
    hostName: row.host_name || "",
    hostPayoutWeekday: nullToEmpty(row.host_payout_weekday),
    hostPayoutWeekend: nullToEmpty(row.host_payout_weekend),
    payoutMode: row.payout_mode || "simples",
    payoutTiers: row.payout_tiers || [],
    payoutIncludedGuests: nullToEmpty(row.payout_included_guests),
    payoutExtraPerGuest: nullToEmpty(row.payout_extra_per_guest),
    breakfastFee: nullToEmpty(row.breakfast_fee),
    breakfastUnit: row.breakfast_unit || "pessoa",
    cleaningFee: nullToEmpty(row.cleaning_fee),
    petFeePerDay: nullToEmpty(row.pet_fee_per_day),
    spaFeePerDay: nullToEmpty(row.spa_fee_per_day),
    mapsLink: row.maps_link || "",
    airbnbLink: row.airbnb_link || "",
    bookingLink: row.booking_link || "",
    photo: row.photo || "",
  };
}

// `properties` é a lista atual em memória — usada para resolver o nome do
// imóvel (como a tela usa) para o property_id (como o banco usa).
function reservationToRow(r, properties) {
  const prop = properties.find((p) => p.name === r.propertyName);
  return {
    id: r.id,
    property_id: prop ? prop.id : null,
    channel: r.channel,
    check_in: r.checkIn,
    check_out: r.checkOut,
    guest_name: r.guestName || "",
    guest_contact: r.guestContact || "",
    value: Number(r.value) || 0,
    net_received: numOrNull(r.netReceived),
    commission_rate: numOrNull(r.commissionRate),
    host_payout: numOrNull(r.hostPayout),
    discount_rate: numOrNull(r.discountRate) ?? 0,
    notes: r.notes || "",
    guest_count: numOrNull(r.guests),
    pet_count: numOrNull(r.pets),
    breakfast: !!r.breakfast,
    spa: !!r.spa,
    payment_status: r.paymentStatus || null,
    booking_commission_amount: numOrNull(r.bookingCommissionAmount),
  };
}

function rowToReservation(row, idToName) {
  return {
    id: row.id,
    propertyName: idToName.get(row.property_id) || "",
    channel: row.channel,
    checkIn: row.check_in,
    checkOut: row.check_out,
    guestName: row.guest_name || "",
    guestContact: row.guest_contact || "",
    value: row.value,
    netReceived: nullToEmpty(row.net_received),
    commissionRate: nullToEmpty(row.commission_rate),
    hostPayout: nullToEmpty(row.host_payout),
    discountRate: row.discount_rate || 0,
    notes: row.notes || "",
    guests: nullToEmpty(row.guest_count),
    pets: nullToEmpty(row.pet_count),
    breakfast: !!row.breakfast,
    spa: !!row.spa,
    paymentStatus: row.payment_status || "pendente",
    bookingCommissionAmount: nullToEmpty(row.booking_commission_amount),
  };
}

export default function App() {
  const [properties, setProperties] = useState(DEFAULT_PROPERTIES);
  const [reservations, setReservations] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [view, setView] = useState("calendario");
  const [selectedProperty, setSelectedProperty] = useState("Todos");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [editingProperty, setEditingProperty] = useState(null);
  const [confirmDeleteProperty, setConfirmDeleteProperty] = useState(null);
  const [propertyDeleteError, setPropertyDeleteError] = useState("");
  const [toast, setToast] = useState(null); // { type: "success" | "error", message }
  const [backupModal, setBackupModal] = useState(null); // { mode: "export"|"import", text }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [authInput, setAuthInput] = useState("");
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setAuthed(!!data.session);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setAuthed(!!session);
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  async function handleLogin() {
    setAuthError(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: SHARED_LOGIN_EMAIL,
      password: authInput,
    });
    if (error) {
      setAuthError(true);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setAuthInput("");
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!authed) return;
    let mounted = true;
    (async () => {
      try {
        const { data: propRows, error: propErr } = await supabase
          .from("properties")
          .select("*")
          .order("name");
        if (propErr) throw propErr;

        const loadedProperties = migratePropertiesList((propRows || []).map(rowToProperty));
        const idToName = new Map((propRows || []).map((row) => [row.id, row.name]));

        const { data: resRows, error: resErr } = await supabase
          .from("reservations")
          .select("*")
          .order("check_in");
        if (resErr) throw resErr;

        const loadedReservations = (resRows || []).map((row) => rowToReservation(row, idToName));

        if (mounted) {
          setProperties(loadedProperties);
          setReservations(loadedReservations);
        }
      } catch (e) {
        // sem dados ainda, ou erro de leitura — mantém os padrões
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [authed]);

  // Cada ação (criar/editar/excluir 1 reserva ou 1 imóvel) grava só a linha
  // afetada na tabela correspondente — não reescreve mais o app inteiro a
  // cada salvamento. Isso é o que resolve o risco de concorrência e de um
  // registro corrompido derrubar o app inteiro.
  // Abre um modal com o backup em texto (JSON) para copiar. Mais confiável
  // que download de arquivo dentro do ambiente do artifact, e funciona no celular.
  function exportData() {
    const payload = JSON.stringify({ properties, reservations }, null, 2);
    setBackupModal({ mode: "export", text: payload });
  }

  // Importar um backup substitui TUDO: apaga as linhas atuais das duas
  // tabelas e insere de novo a partir do texto colado. É a única operação
  // que continua sendo "tudo de uma vez" — faz sentido aqui, já que a
  // intenção de quem importa um backup é reconstituir o estado inteiro.
  // Reservas são apagadas antes dos imóveis por causa da referência entre
  // as tabelas (uma reserva sempre aponta para um imóvel existente).
  async function importData(text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.properties) || !Array.isArray(parsed.reservations)) {
        throw new Error("formato inválido");
      }
      const migratedProperties = migratePropertiesList(parsed.properties);
      const migratedReservations = parsed.reservations;
      setProperties(migratedProperties);
      setReservations(migratedReservations);
      setBackupModal(null);

      const { error: delResErr } = await supabase.from("reservations").delete().neq("id", "");
      const { error: delPropErr } = await supabase.from("properties").delete().neq("id", "");
      const { error: insPropErr } = migratedProperties.length
        ? await supabase.from("properties").insert(migratedProperties.map(propertyToRow))
        : { error: null };
      const { error: insResErr } = migratedReservations.length
        ? await supabase
            .from("reservations")
            .insert(migratedReservations.map((r) => reservationToRow(r, migratedProperties)))
        : { error: null };

      const ok = !delResErr && !delPropErr && !insPropErr && !insResErr;
      setStorageError(!ok);
      setToast(
        ok
          ? { type: "success", message: "Backup importado e salvo ✓" }
          : {
              type: "error",
              message: "Backup carregado na tela, mas não confirmei o salvamento. Tente de novo.",
            }
      );
    } catch (e) {
      setToast({
        type: "error",
        message: "Não consegui ler esse texto. Confira se colou o backup completo do Mirante.",
      });
    }
  }

  async function upsertReservation(resv) {
    const isNew = !resv.id;
    const finalResv = isNew ? { ...resv, id: genId() } : resv;
    let updated;
    if (!isNew) {
      updated = reservations.map((r) => (r.id === resv.id ? resv : r));
    } else {
      updated = [...reservations, finalResv];
    }
    updated.sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
    setReservations(updated);
    setShowForm(false);
    setEditing(null);
    setSelectedProperty("Todos");
    const { error } = await supabase
      .from("reservations")
      .upsert(reservationToRow(finalResv, properties));
    const ok = !error;
    setStorageError(!ok);
    setToast(
      ok
        ? { type: "success", message: "Reserva salva ✓" }
        : {
            type: "error",
            message:
              "Não foi possível confirmar o salvamento. Verifique sua conexão e tente novamente.",
          }
    );
  }

  async function deleteReservation(id) {
    const updated = reservations.filter((r) => r.id !== id);
    setReservations(updated);
    setConfirmDeleteId(null);
    const { error } = await supabase.from("reservations").delete().eq("id", id);
    const ok = !error;
    setStorageError(!ok);
    setToast(
      ok
        ? { type: "success", message: "Reserva excluída ✓" }
        : {
            type: "error",
            message: "Não foi possível confirmar a exclusão. Tente novamente.",
          }
    );
  }

  async function addProperty(name) {
    const clean = name.trim();
    if (!clean || properties.some((p) => p.name === clean)) return;
    const newProp = {
      id: genId(),
      name: clean,
      hostName: "",
      hostPayoutWeekday: "",
      hostPayoutWeekend: "",
      payoutMode: "simples",
      payoutTiers: [],
      payoutIncludedGuests: "",
      payoutExtraPerGuest: "",
      breakfastFee: "",
      breakfastUnit: "pessoa",
      cleaningFee: "",
      petFeePerDay: "",
      spaFeePerDay: "",
      mapsLink: "",
      airbnbLink: "",
      bookingLink: "",
      photo: "",
    };
    setProperties([...properties, newProp]);
    const { error } = await supabase.from("properties").insert(propertyToRow(newProp));
    const ok = !error;
    setStorageError(!ok);
    setToast(
      ok
        ? { type: "success", message: "Imóvel salvo ✓" }
        : {
            type: "error",
            message: "Não foi possível confirmar o salvamento do imóvel.",
          }
    );
  }

  // Nota: como as reservas agora se ligam ao imóvel por id (não por nome),
  // renomear um imóvel aqui não precisa mais tocar nas reservas — elas
  // continuam apontando para o mesmo id e mostram o nome novo automaticamente
  // assim que a lista de imóveis é recarregada.
  async function upsertProperty(propObj) {
    const isNew = !(propObj.id && properties.some((p) => p.id === propObj.id));
    const finalProp = isNew ? { ...propObj, id: genId() } : propObj;
    const updatedProperties = isNew
      ? [...properties, finalProp]
      : properties.map((p) => (p.id === finalProp.id ? finalProp : p));
    setProperties(updatedProperties);
    setShowPropertyForm(false);
    setEditingProperty(null);
    const { error } = await supabase.from("properties").upsert(propertyToRow(finalProp));
    const ok = !error;
    setStorageError(!ok);
    setToast(
      ok
        ? { type: "success", message: "Imóvel salvo ✓" }
        : {
            type: "error",
            message: "Não foi possível confirmar o salvamento do imóvel.",
          }
    );
  }

  function requestDeleteProperty(prop) {
    const inUse = reservations.some((r) => r.propertyName === prop.name);
    if (inUse) {
      setPropertyDeleteError(
        `"${prop.name}" tem reservas cadastradas. Mude ou exclua essas reservas antes de remover o imóvel.`
      );
      return;
    }
    setPropertyDeleteError("");
    setConfirmDeleteProperty(prop);
  }

  async function deleteProperty(prop) {
    const updated = properties.filter((p) => p.id !== prop.id);
    setProperties(updated);
    setConfirmDeleteProperty(null);
    const { error } = await supabase.from("properties").delete().eq("id", prop.id);
    const ok = !error;
    setStorageError(!ok);
    setToast(
      ok
        ? { type: "success", message: "Imóvel excluído ✓" }
        : {
            type: "error",
            message: "Não foi possível confirmar a exclusão do imóvel.",
          }
    );
  }

  const [listPeriod, setListPeriod] = useState("proximas"); // "proximas" | "anteriores" | "todas"
  const [listStatus, setListStatus] = useState("todos"); // "todos" | "pago" | "pendente"

  const filteredSorted = useMemo(() => {
    const today = todayISO();
    let list =
      selectedProperty === "Todos"
        ? reservations
        : reservations.filter((r) => r.propertyName === selectedProperty);
    // "Anterior" = já fez check-out; em andamento conta como próxima.
    const isPast = (r) => r.checkOut <= today;
    if (listPeriod === "proximas") list = list.filter((r) => !isPast(r));
    else if (listPeriod === "anteriores") list = list.filter(isPast);
    if (listStatus === "pago") list = list.filter((r) => r.paymentStatus === "pago");
    else if (listStatus === "pendente") list = list.filter((r) => r.paymentStatus !== "pago");
    const asc = (a, b) => (a.checkIn < b.checkIn ? -1 : 1);
    const desc = (a, b) => (a.checkIn > b.checkIn ? -1 : 1);
    if (listPeriod === "anteriores") return [...list].sort(desc);
    if (listPeriod === "todas") {
      const upcoming = list.filter((r) => !isPast(r)).sort(asc);
      const past = list.filter(isPast).sort(desc);
      return [...upcoming, ...past];
    }
    return [...list].sort(asc);
  }, [reservations, selectedProperty, listPeriod, listStatus]);

  const stats = useMemo(() => {
    const today = todayISO();
    const countUpTo = (days) => {
      const lim = new Date();
      lim.setDate(lim.getDate() + days);
      const limISO = dateToISO(lim);
      return reservations.filter((r) => r.checkIn >= today && r.checkIn <= limISO)
        .length;
    };
    const upcoming7 = countUpTo(7);
    const upcoming15 = countUpTo(15);
    const upcoming30 = countUpTo(30);
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    const commissionMonth = reservations
      .filter((r) => r.checkIn.startsWith(monthPrefix))
      .reduce((sum, r) => sum + earningsForReservation(r), 0);
    return { upcoming7, upcoming15, upcoming30, commissionMonth };
  }, [reservations]);

  if (!authChecked) {
    return (
      <div
        style={{ background: TOKENS.sand, minHeight: "100vh" }}
        className="flex items-center justify-center"
      >
        <FontLoader />
      </div>
    );
  }

  if (!authed) {
    return (
      <div
        style={{ background: TOKENS.sand, minHeight: "100vh" }}
        className="flex items-center justify-center px-6"
      >
        <FontLoader />
        <div
          className="w-full max-w-xs rounded-2xl p-6"
          style={{ background: TOKENS.cream, border: `1px solid ${TOKENS.clayLight}` }}
        >
          <div className="flex flex-col items-center mb-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
              style={{ background: TOKENS.headerBg }}
            >
              <Lock size={22} color={TOKENS.cream} />
            </div>
            <p className="font-heading text-lg" style={{ color: TOKENS.ink }}>
              Mirante
            </p>
            <p className="font-body text-sm text-center mt-1" style={{ color: TOKENS.river }}>
              Digite a senha para acessar
            </p>
          </div>
          <input
            type="password"
            autoFocus
            value={authInput}
            onChange={(e) => {
              setAuthInput(e.target.value);
              if (authError) setAuthError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
            placeholder="Senha"
            className="w-full rounded-xl px-4 py-3 font-body mb-2 outline-none"
            style={{
              background: "#fff",
              border: `1px solid ${authError ? TOKENS.danger : TOKENS.clayLight}`,
              color: TOKENS.ink,
            }}
          />
          {authError && (
            <p className="font-body text-sm mb-2" style={{ color: TOKENS.danger }}>
              Senha incorreta.
            </p>
          )}
          <button
            type="button"
            onClick={handleLogin}
            className="w-full rounded-xl py-3 font-body font-semibold mt-2"
            style={{ background: TOKENS.pine, color: TOKENS.cream }}
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div
        style={{ background: TOKENS.sand, minHeight: "100vh" }}
        className="flex items-center justify-center"
      >
        <FontLoader />
        <p className="font-body" style={{ color: TOKENS.pine }}>
          Carregando mirante…
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: TOKENS.sand, minHeight: "100vh" }} className="pb-28">
      <div className={view === "calendario" ? "w-full" : "max-w-xl mx-auto lg:max-w-5xl"}>
      <FontLoader />
      <Toast toast={toast} />
      <Header view={view} onMenuClick={() => setDrawerOpen(true)} />

      {drawerOpen && (
        <NavDrawer
          view={view}
          setView={(id) => {
            setView(id);
            setDrawerOpen(false);
          }}
          stats={stats}
          onExport={() => {
            exportData();
            setDrawerOpen(false);
          }}
          onImportClick={() => {
            setBackupModal({ mode: "import", text: "" });
            setDrawerOpen(false);
          }}
          onLogout={() => {
            setDrawerOpen(false);
            handleLogout();
          }}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {view === "lista" && (
        <>
          <div className="mx-5 mt-2 flex flex-wrap gap-1.5">
            {[
              ["proximas", "Próximas"],
              ["anteriores", "Anteriores"],
              ["todas", "Todas"],
            ].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setListPeriod(val)}
                className="font-body text-xs px-3 py-1.5 rounded-full"
                style={{
                  background: listPeriod === val ? TOKENS.pine : TOKENS.cream,
                  color: listPeriod === val ? TOKENS.cream : TOKENS.ink,
                }}
              >
                {label}
              </button>
            ))}
            <span className="w-px self-stretch" style={{ background: TOKENS.cream }} />
            {[
              ["todos", "Todos"],
              ["pago", "Pagas"],
              ["pendente", "Pendentes"],
            ].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setListStatus(val)}
                className="font-body text-xs px-3 py-1.5 rounded-full"
                style={{
                  background: listStatus === val ? TOKENS.clay : TOKENS.cream,
                  color: listStatus === val ? "white" : TOKENS.ink,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <ReservationList
            reservations={filteredSorted}
            onEdit={(r) => {
              setEditing(r);
              setShowForm(true);
            }}
            onDelete={(id) => setConfirmDeleteId(id)}
          />
        </>
      )}
      {view === "calendario" && (
        <CalendarView
          properties={properties}
          selectedProperty={selectedProperty}
          setSelectedProperty={setSelectedProperty}
          reservations={reservations}
          calendarMonth={calendarMonth}
          setCalendarMonth={setCalendarMonth}
          onSelectReservation={(r) => {
            setEditing(r);
            setShowForm(true);
          }}
          onQuickAdd={(propertyName, dateISO) => {
            setPendingDraft({
              propertyName,
              checkIn: dateISO,
              checkOut: addDaysISO(dateISO, 1),
            });
            setShowChannelPicker(true);
          }}
        />
      )}
      {view === "imoveis" && (
        <PropertiesManager
          properties={properties}
          deleteError={propertyDeleteError}
          onEdit={(p) => {
            setEditingProperty(p);
            setShowPropertyForm(true);
          }}
          onDeleteRequest={requestDeleteProperty}
        />
      )}

      {view === "comissao" && (
        <CommissionView reservations={reservations} />
      )}

      {view === "relatorios" && (
        <ReportsView reservations={reservations} properties={properties} />
      )}

      {storageError && (
        <div
          className="mx-4 mt-3 rounded-xl p-3 text-sm font-body flex items-start gap-2"
          style={{ background: "#F0E6DB", color: TOKENS.danger }}
        >
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>
            Não consegui salvar os dados agora. Suas últimas alterações podem
            não ter sido guardadas — tente novamente em instantes.
          </span>
        </div>
      )}
      </div>

      {/* Floating action buttons */}
      {view !== "comissao" && (
        <div className="fixed bottom-6 inset-x-0 z-30 pointer-events-none">
          <div className={(view === "calendario" ? "w-full" : "max-w-xl mx-auto lg:max-w-5xl") + " flex justify-end pr-5"}>
            <div className="flex flex-col gap-3 pointer-events-auto">
              <button
                onClick={() => {
                  if (view === "imoveis") {
                    setEditingProperty(null);
                    setShowPropertyForm(true);
                  } else {
                    setPendingDraft({});
                    setShowChannelPicker(true);
                  }
                }}
                className="rounded-full shadow-lg flex items-center justify-center w-14 h-14"
                style={{ background: TOKENS.clay }}
                aria-label={view === "imoveis" ? "Novo imóvel" : "Nova reserva"}
              >
                <Plus size={26} color="white" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showChannelPicker && (
        <ChannelPicker
          onCancel={() => {
            setShowChannelPicker(false);
            setPendingDraft(null);
          }}
          onSelect={(channelId) => {
            setEditing({ ...pendingDraft, channel: channelId });
            setPendingDraft(null);
            setShowChannelPicker(false);
            setShowForm(true);
          }}
        />
      )}

      {showForm && (
        <ReservationForm
          properties={properties}
          initial={editing}
          onAddProperty={addProperty}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSave={upsertReservation}
        />
      )}

      {confirmDeleteId && (
        <ConfirmModal
          message="Excluir esta reserva? Essa ação não pode ser desfeita."
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteReservation(confirmDeleteId)}
        />
      )}

      {showPropertyForm && (
        <PropertyForm
          initial={editingProperty}
          properties={properties}
          onCancel={() => {
            setShowPropertyForm(false);
            setEditingProperty(null);
          }}
          onSave={upsertProperty}
        />
      )}

      {confirmDeleteProperty && (
        <ConfirmModal
          message={`Excluir o imóvel "${confirmDeleteProperty.name}"? Essa ação não pode ser desfeita.`}
          onCancel={() => setConfirmDeleteProperty(null)}
          onConfirm={() => deleteProperty(confirmDeleteProperty)}
        />
      )}

      {backupModal && (
        <BackupModal
          modal={backupModal}
          onChangeText={(t) => setBackupModal({ ...backupModal, text: t })}
          onClose={() => setBackupModal(null)}
          onImport={() => importData(backupModal.text)}
        />
      )}
    </div>
  );
}

function FontLoader() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;1,500&family=Work+Sans:wght@400;500;600;700&display=swap');
      .font-display { font-family: 'Fraunces', serif; }
      .font-body { font-family: 'Work Sans', sans-serif; }
      .trail-wrap { position: relative; padding-left: 26px; }
      .trail-wrap::before {
        content: '';
        position: absolute;
        left: 8px;
        top: 6px;
        bottom: 6px;
        width: 2px;
        background: repeating-linear-gradient(
          to bottom,
          ${TOKENS.moss} 0px,
          ${TOKENS.moss} 6px,
          transparent 6px,
          transparent 12px
        );
      }
      .trail-dot {
        position: absolute;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid ${TOKENS.cream};
      }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: ${TOKENS.moss}; border-radius: 999px; }
      ::-webkit-scrollbar-track { background: transparent; }
    `}</style>
  );
}

const NAV_TABS = [
  { id: "calendario", label: "Calendário", Icon: CalendarIcon },
  { id: "lista", label: "Lista", Icon: ListIcon },
  { id: "imoveis", label: "Imóveis", Icon: Home },
  { id: "comissao", label: "Comissão", Icon: Percent },
  { id: "relatorios", label: "Relatórios", Icon: FileText },
];

function Header({ view, onMenuClick }) {
  const activeLabel = NAV_TABS.find((t) => t.id === view)?.label || "";
  return (
    <div
      className="px-4 pt-3 pb-2.5 sticky top-0 z-20 flex items-center justify-between gap-3"
      style={{ background: TOKENS.headerBg }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          aria-label="Abrir menu"
          className="flex items-center justify-center w-9 h-9 rounded-full shrink-0"
          style={{ background: TOKENS.pineDark }}
        >
          <Menu size={18} color={TOKENS.cream} />
        </button>
        <div className="flex items-center gap-1.5">
          <Leaf size={14} color={TOKENS.clayLight} />
          <h1 className="font-display text-base" style={{ color: TOKENS.cream }}>
            Mirante
          </h1>
        </div>
      </div>
      <span className="font-body text-xs" style={{ color: TOKENS.moss }}>
        {activeLabel}
      </span>
    </div>
  );
}

function NavDrawer({ view, setView, stats, onExport, onImportClick, onLogout, onClose }) {
  return (
    <div
      className="fixed inset-0 z-40 flex"
      style={{ background: "rgba(34,38,31,0.5)" }}
      onClick={onClose}
    >
      <div
        className="h-full flex flex-col"
        style={{ width: 272, maxWidth: "82vw", background: TOKENS.pineDark, padding: "22px 16px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Leaf size={16} color={TOKENS.clayLight} />
            <h2 className="font-display text-lg" style={{ color: TOKENS.cream }}>
              Mirante
            </h2>
          </div>
          <button onClick={onClose} aria-label="Fechar menu">
            <X size={20} color={TOKENS.cream} />
          </button>
        </div>

        <p
          className="font-body text-[10px] tracking-wide uppercase mb-2"
          style={{ color: TOKENS.moss }}
        >
          Navegar
        </p>
        <div className="flex flex-col gap-0.5 mb-4">
          {NAV_TABS.map(({ id, label, Icon }) => {
            const active = view === id;
            return (
              <button
                key={id}
                onClick={() => setView(id)}
                className="font-body text-sm flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left"
                style={{
                  background: active ? TOKENS.pine : "transparent",
                  color: active ? TOKENS.cream : "#C9CDBE",
                  fontWeight: active ? 600 : 500,
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "6px 0 14px" }} />

        <p
          className="font-body text-[10px] tracking-wide uppercase mb-2"
          style={{ color: TOKENS.moss }}
        >
          Próximas reservas
        </p>
        <div className="flex gap-2 mb-4">
          {[
            ["7d", stats.upcoming7],
            ["15d", stats.upcoming15],
            ["30d", stats.upcoming30],
          ].map(([label, count]) => (
            <div
              key={label}
              className="flex-1 rounded-lg py-2 text-center"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <p className="font-body text-[9px]" style={{ color: TOKENS.moss }}>
                {label}
              </p>
              <p className="font-display text-base" style={{ color: TOKENS.clayLight }}>
                {count}
              </p>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "0 0 14px" }} />

        <div className="flex gap-2 mt-auto">
          <button
            onClick={onExport}
            className="font-body text-xs flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl"
            style={{ background: "rgba(255,255,255,0.06)", color: "#C9CDBE" }}
          >
            <Download size={13} /> Backup
          </button>
          <button
            onClick={onImportClick}
            className="font-body text-xs flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl"
            style={{ background: "rgba(255,255,255,0.06)", color: "#C9CDBE" }}
          >
            <Upload size={13} /> Importar
          </button>
        </div>
        <button
          onClick={onLogout}
          className="font-body text-xs flex items-center justify-center gap-1.5 py-2.5 rounded-xl mt-2"
          style={{ background: "rgba(255,255,255,0.06)", color: "#C9CDBE" }}
        >
          <LogOut size={13} /> Sair
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const isPago = status === "pago";
  return (
    <span
      className="font-body text-[11px] px-2 py-0.5 rounded-full"
      style={{
        background: isPago ? "#DEE3DA" : "#F0E6DB",
        color: isPago ? TOKENS.pine : TOKENS.clay,
      }}
    >
      {isPago ? "Pago ao proprietário" : "Pendente"}
    </span>
  );
}

const MONTH_NAMES_FULL = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function CommissionView({ reservations }) {
  const [monthDate, setMonthDate] = useState(new Date());

  const monthPrefix = `${monthDate.getFullYear()}-${String(
    monthDate.getMonth() + 1
  ).padStart(2, "0")}`;
  const monthLabel = `${MONTH_NAMES_FULL[monthDate.getMonth()]} de ${monthDate.getFullYear()}`;

  function shiftMonth(delta) {
    const next = new Date(monthDate);
    next.setMonth(next.getMonth() + delta);
    setMonthDate(next);
  }

  const monthReservations = useMemo(
    () =>
      reservations
        .filter((r) => r.checkIn.startsWith(monthPrefix))
        .sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1)),
    [reservations, monthPrefix]
  );

  const totalCommission = monthReservations.reduce(
    (sum, r) => sum + earningsForReservation(r),
    0
  );

  const byProperty = useMemo(() => {
    const map = {};
    monthReservations.forEach((r) => {
      const c = earningsForReservation(r);
      map[r.propertyName] = (map[r.propertyName] || 0) + c;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [monthReservations]);

  return (
    <div className="mx-5 mt-2">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shiftMonth(-1)} aria-label="Mês anterior">
          <ChevronLeft size={20} color={TOKENS.pine} />
        </button>
        <p className="font-body text-sm capitalize" style={{ color: TOKENS.ink }}>
          {monthLabel}
        </p>
        <button onClick={() => shiftMonth(1)} aria-label="Próximo mês">
          <ChevronRight size={20} color={TOKENS.pine} />
        </button>
      </div>

      <div className="rounded-2xl p-4 mb-4" style={{ background: TOKENS.pine }}>
        <p className="font-body text-xs" style={{ color: TOKENS.moss }}>
          Comissão total do mês
        </p>
        <p className="font-display text-3xl" style={{ color: TOKENS.clayLight }}>
          {fmtMoney(totalCommission)}
        </p>
      </div>

      {byProperty.length > 0 && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: TOKENS.cream }}>
          <p className="font-body text-xs mb-2" style={{ color: TOKENS.moss }}>
            Por imóvel
          </p>
          <div className="flex flex-col gap-2">
            {byProperty.map(([name, value]) => (
              <div key={name} className="flex justify-between gap-2">
                <span className="font-body text-sm" style={{ color: TOKENS.ink }}>
                  {name}
                </span>
                <span
                  className="font-body text-sm font-semibold shrink-0"
                  style={{ color: TOKENS.pine }}
                >
                  {fmtMoney(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {monthReservations.length === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={{ background: TOKENS.cream }}>
          <p className="font-body text-sm" style={{ color: TOKENS.ink }}>
            Nenhuma reserva com check-in nesse mês.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {monthReservations.map((r) => {
            const commission = earningsForReservation(r);
            return (
              <div key={r.id} className="rounded-2xl p-3" style={{ background: TOKENS.cream }}>
                <div className="flex justify-between items-start gap-2">
                  <p className="font-body text-sm" style={{ color: TOKENS.ink }}>
                    <b>{r.guestName}</b> · {r.propertyName}
                  </p>
                  <StatusBadge status={r.paymentStatus} />
                </div>
                <p className="font-body text-xs mt-1" style={{ color: TOKENS.moss }}>
                  {fmtDateBR(r.checkIn)} → {fmtDateBR(r.checkOut)}
                </p>
                <p className="font-body text-sm mt-1" style={{ color: TOKENS.ink }}>
                  {r.channel === "airbnb" ? (
                    <>Valor recebido (Airbnb): <b>{fmtMoney(commission)}</b></>
                  ) : r.channel === "booking" ? (
                    <>
                      {fmtMoney(r.netReceived)} (líquido Booking){" "}
                      {hasFixedPayout(r)
                        ? <>− repasse {fmtMoney(r.hostPayout)} =</>
                        : <>· {(r.commissionRate * 100).toFixed(0)}% =</>}{" "}
                      <b>{fmtMoney(commission)}</b>
                    </>
                  ) : (
                    <>
                      {fmtMoney(effectiveValue(r))}{" "}
                      {hasFixedPayout(r)
                        ? <>− repasse {fmtMoney(r.hostPayout)} =</>
                        : <>· {(r.commissionRate * 100).toFixed(0)}% =</>}{" "}
                      <b>{fmtMoney(commission)}</b>
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReportsView({ reservations, properties }) {
  const [monthDate, setMonthDate] = useState(new Date());
  const [reportProperty, setReportProperty] = useState("");
  const [copied, setCopied] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);

  const monthPrefix = `${monthDate.getFullYear()}-${String(
    monthDate.getMonth() + 1
  ).padStart(2, "0")}`;
  const monthLabel = `${MONTH_NAMES_FULL[monthDate.getMonth()]} de ${monthDate.getFullYear()}`;

  function shiftMonth(delta) {
    const next = new Date(monthDate);
    next.setMonth(next.getMonth() + delta);
    setMonthDate(next);
  }

  const monthReservations = useMemo(
    () =>
      reservations
        .filter((r) => r.checkIn.startsWith(monthPrefix))
        .sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1)),
    [reservations, monthPrefix]
  );

  const byProperty = useMemo(() => {
    const map = {};
    monthReservations.forEach((r) => {
      if (!map[r.propertyName])
        map[r.propertyName] = { count: 0, received: 0, payout: 0, commission: 0, viaAirbnb: 0 };
      const m = map[r.propertyName];
      m.count += 1;
      m.received += receivedForReservation(r);
      m.commission += earningsForReservation(r);
      const p = payoutForReservation(r);
      if (p === null) m.viaAirbnb += 1;
      else m.payout += p;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [monthReservations]);

  const totals = byProperty.reduce(
    (acc, [, m]) => ({
      count: acc.count + m.count,
      received: acc.received + m.received,
      payout: acc.payout + m.payout,
      commission: acc.commission + m.commission,
    }),
    { count: 0, received: 0, payout: 0, commission: 0 }
  );

  // Seleção pode ser um imóvel ("Nome") ou um dono ("owner:Nome") — no caso
  // do dono, agrupa todos os imóveis dele num relatório só.
  const isOwnerReport = reportProperty.startsWith("owner:");
  const ownerName = isOwnerReport ? reportProperty.slice(6) : null;
  const selectedPropNames = isOwnerReport
    ? properties.filter((p) => (p.hostName || "").trim() === ownerName).map((p) => p.name)
    : [reportProperty];
  const ownerReservations = monthReservations.filter((r) =>
    selectedPropNames.includes(r.propertyName)
  );
  const ownerProp = isOwnerReport
    ? null
    : properties.find((p) => p.name === reportProperty) || null;
  const ownerPayoutTotal = ownerReservations.reduce(
    (sum, r) => sum + (payoutForReservation(r) ?? 0),
    0
  );
  // Donos únicos (hostName preenchido) para o agrupamento no seletor.
  const owners = [...new Set(properties.map((p) => (p.hostName || "").trim()).filter(Boolean))].sort();
  // Reservas agrupadas por imóvel (para o relatório de dono).
  const groupedByProp = selectedPropNames
    .map((name) => ({
      name,
      items: ownerReservations.filter((r) => r.propertyName === name),
    }))
    .filter((g) => g.items.length > 0);

  function ownerReportText() {
    const lines = [];
    lines.push(
      `Acerto de ${monthLabel} — ${isOwnerReport ? ownerName : reportProperty}`
    );
    if (!isOwnerReport && ownerProp && ownerProp.hostName)
      lines.push(`Anfitrião: ${ownerProp.hostName}`);
    lines.push("");
    if (isOwnerReport) {
      groupedByProp.forEach((g) => {
        const subtotal = g.items.reduce((s, r) => s + (payoutForReservation(r) ?? 0), 0);
        lines.push(`${g.name}:`);
        g.items.forEach((r) => {
          const nights = nightsBetween(r.checkIn, r.checkOut);
          const p = payoutForReservation(r);
          lines.push(
            `• ${fmtDateBR(r.checkIn)} a ${fmtDateBR(r.checkOut)} (${nights} noite${
              nights === 1 ? "" : "s"
            }) — ${r.guestName} — ${p === null ? "pago via Airbnb" : "repasse " + fmtMoney(p)}`
          );
        });
        lines.push(`Subtotal ${g.name}: ${fmtMoney(subtotal)}`);
        lines.push("");
      });
    } else {
      ownerReservations.forEach((r) => {
        const nights = nightsBetween(r.checkIn, r.checkOut);
        const p = payoutForReservation(r);
        lines.push(
          `• ${fmtDateBR(r.checkIn)} a ${fmtDateBR(r.checkOut)} (${nights} noite${
            nights === 1 ? "" : "s"
          }) — ${r.guestName} — ${p === null ? "pago via Airbnb" : "repasse " + fmtMoney(p)}`
        );
      });
      lines.push("");
    }
    lines.push(`Total a repassar: ${fmtMoney(ownerPayoutTotal)}`);
    return lines.join("\n");
  }

  // Copiar com dupla tentativa: clipboard API e, se bloqueada (comum em
  // ambientes restritos), execCommand com textarea temporária. Se ambas
  // falharem, abre o modal com o texto para copiar manualmente.
  async function copyOwnerReport() {
    const text = ownerReportText();
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) {}
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e) {}
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setShowTextModal(true);
    }
  }


  return (
    <div className="mx-5 mt-2">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #report-print, #report-print * { visibility: visible; }
          #report-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shiftMonth(-1)} aria-label="Mês anterior">
          <ChevronLeft size={20} color={TOKENS.pine} />
        </button>
        <p className="font-body text-sm capitalize" style={{ color: TOKENS.ink }}>
          {monthLabel}
        </p>
        <button onClick={() => shiftMonth(1)} aria-label="Próximo mês">
          <ChevronRight size={20} color={TOKENS.pine} />
        </button>
      </div>

      {monthReservations.length === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={{ background: TOKENS.cream }}>
          <FileText size={26} color={TOKENS.moss} className="mx-auto mb-2" />
          <p className="font-body text-sm" style={{ color: TOKENS.ink }}>
            Nenhuma reserva com check-in neste mês.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl p-4 mb-4" style={{ background: TOKENS.pine }}>
            <p className="font-body text-xs mb-2" style={{ color: TOKENS.clayLight }}>
              Meu controle · {totals.count} reserva{totals.count === 1 ? "" : "s"}
            </p>
            <div className="flex justify-between font-body text-sm" style={{ color: TOKENS.cream }}>
              <span>Recebido</span>
              <b>{fmtMoney(totals.received)}</b>
            </div>
            <div className="flex justify-between font-body text-sm mt-1" style={{ color: TOKENS.cream }}>
              <span>A repassar</span>
              <b>{fmtMoney(totals.payout)}</b>
            </div>
            <div
              className="flex justify-between font-body text-sm mt-1 pt-1"
              style={{ color: TOKENS.clayLight, borderTop: `1px solid ${TOKENS.pineDark}` }}
            >
              <span>Comissão</span>
              <b>{fmtMoney(totals.commission)}</b>
            </div>
          </div>

          <div className="flex flex-col gap-2 mb-5">
            {byProperty.map(([name, m]) => (
              <div key={name} className="rounded-2xl p-3" style={{ background: TOKENS.cream }}>
                <p className="font-body text-sm font-semibold" style={{ color: TOKENS.ink }}>
                  {name}{" "}
                  <span className="font-normal" style={{ color: TOKENS.moss }}>
                    · {m.count} reserva{m.count === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="font-body text-sm mt-1" style={{ color: TOKENS.ink }}>
                  Repasse: <b>{fmtMoney(m.payout)}</b> · Comissão: <b>{fmtMoney(m.commission)}</b>
                  {m.viaAirbnb > 0 && (
                    <span style={{ color: TOKENS.moss }}>
                      {" "}· {m.viaAirbnb} via Airbnb
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>

          <p className="font-display text-lg mb-2" style={{ color: TOKENS.ink }}>
            Relatório para o dono
          </p>
          <Field label="Dono ou imóvel">
            <select
              style={inputStyle}
              value={reportProperty}
              onChange={(e) => setReportProperty(e.target.value)}
            >
              <option value="">Escolha…</option>
              {owners.length > 0 && (
                <optgroup label="Por dono (agrupa os imóveis)">
                  {owners.map((o) => (
                    <option key={`owner:${o}`} value={`owner:${o}`}>
                      👤 {o}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Por imóvel">
                {properties.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>

          {reportProperty && (
            <>
              <div id="report-print" className="rounded-2xl p-4" style={{ background: TOKENS.cream }}>
                <p className="font-display text-lg" style={{ color: TOKENS.ink }}>
                  Acerto de {monthLabel}
                </p>
                <p className="font-body text-sm" style={{ color: TOKENS.ink }}>
                  {isOwnerReport ? `Anfitrião: ${ownerName}` : reportProperty}
                  {!isOwnerReport && ownerProp && ownerProp.hostName
                    ? ` · Anfitrião: ${ownerProp.hostName}`
                    : ""}
                </p>
                {ownerReservations.length === 0 ? (
                  <p className="font-body text-sm mt-3" style={{ color: TOKENS.moss }}>
                    Nenhuma reserva neste mês.
                  </p>
                ) : isOwnerReport ? (
                  <div className="mt-3 flex flex-col gap-3">
                    {groupedByProp.map((g) => {
                      const subtotal = g.items.reduce(
                        (s, r) => s + (payoutForReservation(r) ?? 0),
                        0
                      );
                      return (
                        <div key={g.name}>
                          <p
                            className="font-body text-sm font-semibold mb-1"
                            style={{ color: TOKENS.pine }}
                          >
                            {g.name}
                          </p>
                          <div className="flex flex-col gap-2">
                            {g.items.map((r) => {
                              const nights = nightsBetween(r.checkIn, r.checkOut);
                              const p = payoutForReservation(r);
                              return (
                                <div
                                  key={r.id}
                                  className="flex justify-between font-body text-sm pb-1"
                                  style={{
                                    color: TOKENS.ink,
                                    borderBottom: `1px solid ${TOKENS.sand}`,
                                  }}
                                >
                                  <span>
                                    {fmtDateBR(r.checkIn)} a {fmtDateBR(r.checkOut)} ({nights}{" "}
                                    noite{nights === 1 ? "" : "s"}) · {r.guestName}
                                  </span>
                                  <b className="shrink-0 ml-2">
                                    {p === null ? "via Airbnb" : fmtMoney(p)}
                                  </b>
                                </div>
                              );
                            })}
                            <div
                              className="flex justify-between font-body text-sm"
                              style={{ color: TOKENS.moss }}
                            >
                              <span>Subtotal {g.name}</span>
                              <b>
                                {fmtMoney(
                                  g.items.reduce(
                                    (s, r) => s + (payoutForReservation(r) ?? 0),
                                    0
                                  )
                                )}
                              </b>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div
                      className="flex justify-between font-body text-base mt-1 pt-2"
                      style={{ color: TOKENS.pine, borderTop: `2px solid ${TOKENS.pine}` }}
                    >
                      <span>Total a repassar</span>
                      <b>{fmtMoney(ownerPayoutTotal)}</b>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {ownerReservations.map((r) => {
                      const nights = nightsBetween(r.checkIn, r.checkOut);
                      const p = payoutForReservation(r);
                      return (
                        <div
                          key={r.id}
                          className="flex justify-between font-body text-sm pb-1"
                          style={{ color: TOKENS.ink, borderBottom: `1px solid ${TOKENS.sand}` }}
                        >
                          <span>
                            {fmtDateBR(r.checkIn)} a {fmtDateBR(r.checkOut)} ({nights} noite
                            {nights === 1 ? "" : "s"}) · {r.guestName}
                          </span>
                          <b className="shrink-0 ml-2">
                            {p === null ? "via Airbnb" : fmtMoney(p)}
                          </b>
                        </div>
                      );
                    })}
                    <div
                      className="flex justify-between font-body text-base mt-1"
                      style={{ color: TOKENS.pine }}
                    >
                      <span>Total a repassar</span>
                      <b>{fmtMoney(ownerPayoutTotal)}</b>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-3 mb-6">
                <button
                  onClick={copyOwnerReport}
                  className="font-body flex-1 py-2.5 rounded-xl text-sm"
                  style={{ background: TOKENS.river, color: "white" }}
                >
                  {copied ? "Copiado ✓" : "Copiar texto"}
                </button>
                <button
                  onClick={() => setShowTextModal(true)}
                  className="font-body flex-1 py-2.5 rounded-xl text-sm"
                  style={{ background: TOKENS.clay, color: "white" }}
                >
                  Ver texto
                </button>
              </div>

              {showTextModal && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center px-5"
                  style={{ background: "rgba(0,0,0,0.45)" }}
                  onClick={() => setShowTextModal(false)}
                >
                  <div
                    className="rounded-2xl p-4 w-full max-w-md"
                    style={{ background: "white", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="font-body text-sm mb-2" style={{ color: TOKENS.ink }}>
                      Texto do relatório — selecione e copie (segure e arraste no
                      celular), ou cole num documento para imprimir/gerar PDF.
                    </p>
                    <textarea
                      readOnly
                      className="font-body text-sm w-full rounded-xl p-3"
                      style={{
                        border: `1px solid ${TOKENS.sand}`,
                        minHeight: "220px",
                        flex: 1,
                        resize: "none",
                        color: TOKENS.ink,
                      }}
                      value={ownerReportText()}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      onClick={() => setShowTextModal(false)}
                      className="font-body text-sm py-2.5 rounded-xl mt-3"
                      style={{ background: TOKENS.pine, color: "white" }}
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function ReservationList({ reservations, onEdit, onDelete }) {
  const today = todayISO();
  if (reservations.length === 0) {
    return (
      <div className="mx-5 mt-6 rounded-2xl p-6 text-center" style={{ background: TOKENS.cream }}>
        <Leaf size={26} color={TOKENS.moss} className="mx-auto mb-2" />
        <p className="font-body text-sm" style={{ color: TOKENS.ink }}>
          Nenhuma reserva por aqui ainda. Toque em <b>+</b> para adicionar a
          primeira.
        </p>
      </div>
    );
  }
  return (
    <div className="trail-wrap mx-5 mt-2 flex flex-col gap-3">
      <p className="font-body text-sm -mb-1" style={{ color: TOKENS.moss }}>
        {reservations.length} reserva{reservations.length === 1 ? "" : "s"} cadastrada{reservations.length === 1 ? "" : "s"}
      </p>
      {reservations.map((r) => {
        const isPast = r.checkOut < today;
        const dotColor = isPast
          ? TOKENS.moss
          : r.paymentStatus === "pago"
          ? TOKENS.pine
          : TOKENS.clay;
        const nights = nightsBetween(r.checkIn, r.checkOut);
        const waLink = r.guestContact
          ? `https://wa.me/${String(r.guestContact).replace(/\D/g, "")}`
          : null;
        return (
          <div key={r.id} style={{ position: "relative" }}>
            <span className="trail-dot" style={{ background: dotColor, top: 18 }} />
            <div
              className="rounded-2xl p-4"
              style={{
                background: TOKENS.cream,
                opacity: isPast ? 0.65 : 1,
              }}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="font-body text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full"
                    style={{ background: TOKENS.sand, color: TOKENS.pine, letterSpacing: "0.04em" }}
                  >
                    {r.propertyName}
                  </span>
                  {r.channel && (
                    <span
                      className="font-body text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full"
                      style={{ background: hexToRgba(channelInfo(r.channel)?.color || TOKENS.moss, 0.15), color: channelInfo(r.channel)?.color || TOKENS.moss, letterSpacing: "0.04em" }}
                    >
                      {channelLabel(r.channel)}
                    </span>
                  )}
                </div>
                <StatusBadge status={r.paymentStatus} />
              </div>
              <p className="font-display text-xl mt-2.5" style={{ color: TOKENS.ink, lineHeight: 1.15 }}>
                {r.guestName}
              </p>
              {r.guestContact && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-body text-xs flex items-center gap-1 mt-1"
                  style={{ color: TOKENS.river }}
                >
                  <Phone size={12} /> {r.guestContact}
                </a>
              )}
              <p className="font-body text-[15px] font-medium mt-2.5" style={{ color: TOKENS.ink }}>
                {fmtDateBR(r.checkIn)} → {fmtDateBR(r.checkOut)}{" "}
                <span className="text-xs font-normal" style={{ color: TOKENS.moss }}>
                  ({nights} noite{nights === 1 ? "" : "s"})
                </span>
                {r.guests !== "" && r.guests !== undefined && r.guests !== null && (
                  <span className="text-xs font-normal" style={{ color: TOKENS.moss }}>
                    {" "}· {r.guests} hóspede{Number(r.guests) === 1 ? "" : "s"}
                  </span>
                )}
                {r.breakfast && (
                  <span className="text-xs font-normal" style={{ color: TOKENS.moss }}> · ☕ com café</span>
                )}
                {Number(r.pets) > 0 && (
                  <span className="text-xs font-normal" style={{ color: TOKENS.moss }}>
                    {" "}· 🐾 {r.pets} pet{Number(r.pets) === 1 ? "" : "s"}
                  </span>
                )}
                {r.spa && (
                  <span className="text-xs font-normal" style={{ color: TOKENS.moss }}> · 🛁 com spa</span>
                )}
              </p>
              <p className="font-display text-lg mt-1.5" style={{ color: TOKENS.ink }}>
                {r.channel === "airbnb" ? (
                  <>
                    <span className="font-body text-xs font-normal" style={{ color: TOKENS.moss }}>Você recebe </span>
                    {fmtMoney(r.netReceived)}
                    {r.value > 0 && (
                      <span className="font-body text-xs" style={{ color: TOKENS.moss }}> · hóspede pagou {fmtMoney(r.value)}</span>
                    )}
                  </>
                ) : r.channel === "booking" ? (
                  <>
                    <span className="font-body text-xs font-normal" style={{ color: TOKENS.moss }}>Booking te pagou </span>
                    {fmtMoney(r.netReceived)}
                    {r.value > 0 && (
                      <span className="font-body text-xs" style={{ color: TOKENS.moss }}> · reserva de {fmtMoney(r.value)}</span>
                    )}
                  </>
                ) : (
                  <>
                    {fmtMoney(effectiveValue(r))}
                    {Number(r.discountRate) > 0 && (
                      <span className="font-body text-xs" style={{ color: TOKENS.moss }}>
                        {" "}(desconto de {(Number(r.discountRate) * 100).toFixed(0)}%)
                      </span>
                    )}
                  </>
                )}
              </p>
              {r.notes && (
                <p className="font-body text-xs mt-1.5 italic" style={{ color: TOKENS.moss }}>
                  {r.notes}
                </p>
              )}
              <div
                className="flex gap-4 mt-3.5 pt-3"
                style={{ borderTop: `1px solid ${TOKENS.sand}` }}
              >
                <button
                  onClick={() => onEdit(r)}
                  className="font-body text-xs flex items-center gap-1"
                  style={{ color: TOKENS.pine }}
                >
                  <Pencil size={13} /> Editar
                </button>
                <button
                  onClick={() => onDelete(r.id)}
                  className="font-body text-xs flex items-center gap-1"
                  style={{ color: TOKENS.danger }}
                >
                  <Trash2 size={13} /> Excluir
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const WEEKDAY_ABBR = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
const MONTH_ABBR = [
  "jan.","fev.","mar.","abr.","mai.","jun.",
  "jul.","ago.","set.","out.","nov.","dez.",
];
const ROW_COLOR_PALETTE = [
  TOKENS.pine,
  TOKENS.river,
  TOKENS.clay,
  TOKENS.moss,
  "#8B5E83",
  "#C9A227",
  "#5B7F8B",
  TOKENS.danger,
];

function propertyColor(index) {
  return ROW_COLOR_PALETTE[index % ROW_COLOR_PALETTE.length];
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Mesma mistura de hexToRgba, mas já resolvida contra fundo branco — opaca,
// para colunas/linhas fixas (sticky) que não podem deixar o conteúdo por
// baixo vazar ao rolar (dedo no celular).
function tintOpaque(hex, alpha) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  const mix = (c) => Math.round(c * alpha + 255 * (1 - alpha));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return dateToISO(d);
}

function fmtDayMonth(date) {
  return `${String(date.getDate()).padStart(2, "0")} ${MONTH_ABBR[date.getMonth()]}`;
}

const CELL_WIDTH = 60;
const NAME_COL_WIDTH = 104;
const ROW_HEIGHT = 56;
// Corte diagonal da barra de reserva: metade da largura do dia, para que o
// check-out de uma reserva e o check-in da próxima no mesmo dia caibam cada
// um dentro do espaço daquele dia (sem invadir o dia vizinho).
const CHAMFER = Math.round(CELL_WIDTH / 2);

function CalendarView({
  properties,
  selectedProperty,
  reservations,
  calendarMonth,
  setCalendarMonth,
  onSelectReservation,
  onQuickAdd,
}) {
  // Janela ampla (9 semanas) para que, mesmo em telas largas, sobre bastante
  // espaço de rolagem entre os dois gatilhos de reancoramento. Janelas curtas
  // faziam a "zona segura" encolher a ponto de a compensação de scroll cair
  // sempre no gatilho oposto, gerando oscilação (a barra pulava de lado a lado).
  const WINDOW_DAYS = 63;
  const SHIFT_DAYS = 7;
  const EDGE_THRESHOLD = CELL_WIDTH * 5;
  const INITIAL_OFFSET = 21; // dias de margem à esquerda do dia de referência

  const [anchor, setAnchor] = useState(() => {
    const d = new Date(calendarMonth);
    d.setDate(d.getDate() - INITIAL_OFFSET);
    return d;
  });
  const [visibleStart, setVisibleStart] = useState(calendarMonth);
  const scrollRef = useRef(null);
  const didInitialScroll = useRef(false);
  // Quanto ajustar o scrollLeft DEPOIS que o React re-renderizar a janela
  // com o novo anchor. É aplicado no useLayoutEffect abaixo (sincronamente,
  // antes do paint), evitando o salto visual de mexer no DOM antigo.
  const pendingScrollAdjust = useRef(0);
  // Último dia de início visível já refletido no estado, para evitar
  // re-render a cada pixel de scroll.
  const lastVisibleDayMs = useRef(null);

  const days = useMemo(() => {
    const arr = [];
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const d = new Date(anchor);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [anchor]);

  const daysISO = useMemo(() => days.map((d) => dateToISO(d)), [days]);

  useEffect(() => {
    if (didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(
      (calendarMonth.getTime() - anchor.getTime()) / 86400000
    );
    el.scrollLeft = Math.max(0, idx) * CELL_WIDTH;
    didInitialScroll.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Depois que o anchor muda e o React re-renderiza a nova janela de dias,
  // aplicamos a compensação de scroll aqui — sincronamente, antes do paint.
  // Isso mantém o mesmo dia sob os olhos do usuário, sem o salto de 7 dias.
  useLayoutEffect(() => {
    if (pendingScrollAdjust.current === 0) return;
    const el = scrollRef.current;
    if (el) el.scrollLeft += pendingScrollAdjust.current;
    pendingScrollAdjust.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // Enquanto uma compensação de anchor está pendente, ignoramos o scroll
    // para não disparar shifts em cascata.
    if (pendingScrollAdjust.current !== 0) return;
    const scrollLeft = el.scrollLeft;

    // Só atualiza o rótulo/estado quando o dia de início realmente muda,
    // e não a cada pixel — evita re-render contínuo durante o arrasto.
    const firstVisible = new Date(anchor);
    firstVisible.setDate(firstVisible.getDate() + Math.round(scrollLeft / CELL_WIDTH));
    const firstVisibleMs = firstVisible.getTime();
    if (firstVisibleMs !== lastVisibleDayMs.current) {
      lastVisibleDayMs.current = firstVisibleMs;
      setVisibleStart(firstVisible);
    }

    const maxScroll = el.scrollWidth - el.clientWidth;
    if (scrollLeft < EDGE_THRESHOLD) {
      // Só reancora se, após a compensação, o scroll couber dentro da zona
      // segura (longe do gatilho oposto). Em telas onde a janela seria estreita
      // demais isso evita o loop de reancoramento (a barra pulando de lado a lado).
      const projected = scrollLeft + SHIFT_DAYS * CELL_WIDTH;
      if (projected > maxScroll - EDGE_THRESHOLD) return;
      // Janela vai crescer 7 dias para a esquerda -> conteúdo desloca +448px.
      // Marcamos a compensação e deixamos o useLayoutEffect aplicá-la após o
      // re-render, evitando o salto visual.
      pendingScrollAdjust.current = SHIFT_DAYS * CELL_WIDTH;
      setAnchor((prev) => {
        const d = new Date(prev);
        d.setDate(d.getDate() - SHIFT_DAYS);
        return d;
      });
    } else if (maxScroll - scrollLeft < EDGE_THRESHOLD) {
      const projected = scrollLeft - SHIFT_DAYS * CELL_WIDTH;
      if (projected < EDGE_THRESHOLD) return;
      pendingScrollAdjust.current = -SHIFT_DAYS * CELL_WIDTH;
      setAnchor((prev) => {
        const d = new Date(prev);
        d.setDate(d.getDate() + SHIFT_DAYS);
        return d;
      });
    }
  }

  function shiftWeek(delta) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: delta * SHIFT_DAYS * CELL_WIDTH, behavior: "smooth" });
  }

  function goToday() {
    const el = scrollRef.current;
    const todayDate = new Date();
    const newAnchor = new Date(todayDate);
    newAnchor.setDate(newAnchor.getDate() - INITIAL_OFFSET);
    setAnchor(newAnchor);
    setCalendarMonth(todayDate);
    setVisibleStart(todayDate);
    lastVisibleDayMs.current = todayDate.getTime();
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = INITIAL_OFFSET * CELL_WIDTH;
    });
  }

  const rowsProperties =
    selectedProperty === "Todos"
      ? properties
      : properties.filter((p) => p.name === selectedProperty);

  const today = todayISO();
  const rangeEnd = new Date(visibleStart);
  rangeEnd.setDate(rangeEnd.getDate() + 6);
  const rangeLabel = `${fmtDayMonth(visibleStart)} – ${fmtDayMonth(
    rangeEnd
  )} ${rangeEnd.getFullYear()}`;

  return (
    <div className="mx-0 sm:mx-4 mt-2">
      <div
        className="flex items-center justify-between mb-3 rounded-2xl px-2 py-2"
        style={{ background: TOKENS.cream, border: `1px solid ${TOKENS.sand}` }}
      >
        <button
          onClick={() => shiftWeek(-1)}
          aria-label="Semana anterior"
          className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
          style={{ background: TOKENS.sand }}
        >
          <ChevronLeft size={18} color={TOKENS.pine} />
        </button>
        <button
          onClick={goToday}
          className="font-display text-base"
          style={{ color: TOKENS.ink }}
          title="Toque para ir para hoje"
        >
          {rangeLabel}
        </button>
        <button
          onClick={() => shiftWeek(1)}
          aria-label="Próxima semana"
          className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
          style={{ background: TOKENS.sand }}
        >
          <ChevronRight size={18} color={TOKENS.pine} />
        </button>
      </div>

      {rowsProperties.length === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={{ background: TOKENS.cream }}>
          <p className="font-body text-sm" style={{ color: TOKENS.ink }}>
            Nenhum imóvel cadastrado ainda. Cadastre um na aba Imóveis.
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="rounded-2xl"
          style={{
            background: TOKENS.cream,
            overflow: "auto",
            maxHeight: "calc(100vh - 215px)",
            border: `1px solid ${TOKENS.sand}`,
            boxShadow: "0 1px 3px rgba(34,38,31,0.06)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `${NAME_COL_WIDTH}px repeat(${days.length}, ${CELL_WIDTH}px)`,
              minWidth: NAME_COL_WIDTH + days.length * CELL_WIDTH,
            }}
          >
            {/* corner cell */}
            <div
              style={{
                position: "sticky",
                top: 0,
                left: 0,
                zIndex: 3,
                background: TOKENS.cream,
                borderBottom: `1px solid ${TOKENS.sand}`,
              }}
              className="p-2"
            />
            {days.map((d, i) => {
              const isToday = daysISO[i] === today;
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div
                  key={i}
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    background: isWeekend ? TOKENS.sand : TOKENS.cream,
                    borderTop: isWeekend ? `3px solid ${TOKENS.ink}` : "3px solid transparent",
                    borderBottom: `2px solid ${isToday ? TOKENS.clay : TOKENS.sand}`,
                  }}
                  className="font-body text-center py-2.5"
                >
                  <p
                    className="text-[10px] font-semibold"
                    style={{ color: TOKENS.moss, letterSpacing: "0.04em" }}
                  >
                    {WEEKDAY_ABBR[d.getDay()]}
                  </p>
                  <p
                    className="text-sm font-semibold inline-flex items-center justify-center"
                    style={{
                      color: isToday ? "white" : TOKENS.ink,
                      background: isToday ? TOKENS.clay : "transparent",
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      marginTop: 2,
                    }}
                  >
                    {d.getDate()}
                  </p>
                </div>
              );
            })}

            {rowsProperties.map((p) => {
              const color = propertyColor(properties.findIndex((pp) => pp.id === p.id));
              const propReservations = reservations.filter((r) => r.propertyName === p.name);
              const rangeStartISO = daysISO[0];
              const rangeEndExclusiveISO = addDaysISO(daysISO[daysISO.length - 1], 1);
              const visibleReservations = propReservations.filter(
                (r) => r.checkOut > rangeStartISO && r.checkIn < rangeEndExclusiveISO
              );
              return (
                <Fragment key={p.id}>
                  <div
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      background: tintOpaque(color, 0.08),
                      borderLeft: `3px solid ${color}`,
                      borderBottom: `1px solid ${TOKENS.sand}`,
                    }}
                    className="p-2 flex items-center"
                  >
                    <p className="font-body text-[12.5px] font-medium leading-tight" style={{ color: TOKENS.ink }}>
                      {p.name}
                    </p>
                  </div>

                  <div
                    style={{
                      gridColumn: `2 / span ${days.length}`,
                      position: "relative",
                      height: "100%",
                      minHeight: ROW_HEIGHT,
                    }}
                  >
                    <div style={{ display: "flex", height: "100%" }}>
                      {daysISO.map((dISO, di) => {
                        const isToday = dISO === today;
                        const isWeekend = days[di].getDay() === 0 || days[di].getDay() === 6;
                        return (
                          <button
                            key={di}
                            onClick={() => onQuickAdd(p.name, dISO)}
                            style={{
                              position: "relative",
                              width: CELL_WIDTH,
                              height: "100%",
                              flexShrink: 0,
                              background: isToday
                                ? hexToRgba(TOKENS.river, 0.12)
                                : isWeekend
                                ? TOKENS.sand
                                : "white",
                              borderBottom: `1px solid ${TOKENS.sand}`,
                              borderRight: `1px solid ${TOKENS.sand}`,
                            }}
                            aria-label="Toque para lançar reserva"
                          />
                        );
                      })}
                    </div>

                    {visibleReservations.map((r) => {
                      const startIdx = daysISO.indexOf(r.checkIn);
                      const endIdx = daysISO.indexOf(r.checkOut);
                      const hasLeftCut = startIdx !== -1;
                      const hasRightCut = endIdx !== -1;
                      const leftIdx = hasLeftCut ? startIdx : 0;
                      const rightIdx = hasRightCut ? endIdx + 1 : daysISO.length;

                      // Reserva encadeada: outra reserva do mesmo imóvel começa exatamente
                      // no dia em que esta termina (ou termina no dia em que esta começa).
                      // Nesse caso usamos um respiro maior nessa ponta, mantendo o corte
                      // diagonal (parallelogramo) para as duas barras encaixarem como um
                      // "zigue-zague" com uma fresta fina entre elas, em vez de ficarem coladas.
                      const prevAdjacent = propReservations.some(
                        (other) => other.id !== r.id && other.checkOut === r.checkIn
                      );
                      const nextAdjacent = propReservations.some(
                        (other) => other.id !== r.id && other.checkIn === r.checkOut
                      );

                      const GAP = 3;
                      const TURNOVER_GAP = 20;

                      const leftGap = hasLeftCut ? (prevAdjacent ? TURNOVER_GAP : GAP) : 0;
                      const rightGap = hasRightCut ? (nextAdjacent ? TURNOVER_GAP : GAP) : 0;

                      const leftPx = leftIdx * CELL_WIDTH + leftGap;
                      const rightEdgePx = rightIdx * CELL_WIDTH - rightGap;
                      const widthPx = rightEdgePx - leftPx;
                      const barColor = r.paymentStatus === "pago" ? TOKENS.pine : TOKENS.clay;
                      const clip = `polygon(${hasLeftCut ? CHAMFER : 0}px 0, 100% 0, calc(100% - ${
                        hasRightCut ? CHAMFER : 0
                      }px) 100%, 0 100%)`;
                      return (
                        <button
                          key={r.id}
                          onClick={() => onSelectReservation(r)}
                          title={`${r.guestName} (${fmtDateBR(r.checkIn)} - ${fmtDateBR(
                            r.checkOut
                          )})`}
                          className="font-body text-sm font-semibold flex items-center justify-center overflow-hidden"
                          style={{
                            position: "absolute",
                            top: 2,
                            left: leftPx,
                            width: widthPx,
                            height: "calc(100% - 4px)",
                            background: barColor,
                            clipPath: clip,
                            border: "none",
                            boxShadow: "none",
                            padding: "0 8px",
                            cursor: "pointer",
                          }}
                        >
                          <span className="truncate" style={{ color: "white", letterSpacing: "0.01em" }}>
                            {r.guestName.split(" ")[0]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      <div
        className="flex gap-4 mt-3 flex-wrap items-center rounded-2xl px-3 py-2.5"
        style={{ background: TOKENS.cream, border: `1px solid ${TOKENS.sand}` }}
      >
        <Legend color={TOKENS.pine} label="Pago" />
        <Legend color={TOKENS.clay} label="Pendente" />
        <Legend color="white" label="Livre" border />
      </div>
    </div>
  );
}

function Legend({ color, label, border }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2.5 h-2.5 rounded-full inline-block"
        style={{ background: color, border: border ? `1px solid ${TOKENS.moss}` : "none" }}
      />
      <span className="font-body text-[11.5px]" style={{ color: TOKENS.ink }}>
        {label}
      </span>
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{ background: "rgba(34,38,31,0.5)" }}
      onClick={onClose}
    >
      <div className="min-h-screen flex items-end sm:items-center justify-center">
        <div
          className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl sm:my-10"
          style={{ background: TOKENS.cream }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 pt-6 pb-4">
            <h2 className="font-display text-2xl" style={{ color: TOKENS.ink, lineHeight: 1.1 }}>
              {title}
            </h2>
            <button onClick={onClose} aria-label="Fechar">
              <X size={22} color={TOKENS.ink} />
            </button>
          </div>
          <div className="px-5 pb-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ChannelPicker({ onCancel, onSelect }) {
  return (
    <Sheet title="Qual o canal desta reserva?" onClose={onCancel}>
      <div className="flex flex-col gap-3">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="font-body text-left rounded-2xl p-4 flex items-center justify-between"
            style={{ background: TOKENS.sand, color: TOKENS.ink }}
          >
            <span className="text-base font-semibold">{c.label}</span>
            <span className="text-sm" style={{ color: TOKENS.moss }}>
              {c.id === "airbnb" || c.id === "booking"
                ? "valor líquido direto"
                : "sem plataforma"}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label
        className="font-body text-[11px] font-semibold uppercase block mb-1.5"
        style={{ color: TOKENS.moss, letterSpacing: "0.04em" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: "12px",
  border: `1px solid ${TOKENS.sand}`,
  background: "white",
  fontFamily: "'Work Sans', sans-serif",
  fontSize: "16px",
  color: TOKENS.ink,
};

function ReservationForm({ properties, initial, onAddProperty, onCancel, onSave }) {
  const [propertyName, setPropertyName] = useState(
    initial?.propertyName || properties[0]?.name || ""
  );
  const [newPropertyMode, setNewPropertyMode] = useState(false);
  const [newPropertyName, setNewPropertyName] = useState("");
  const [guestName, setGuestName] = useState(initial?.guestName || "");
  const [guestContact, setGuestContact] = useState(initial?.guestContact || "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn || "");
  const [guests, setGuests] = useState(initial?.guests ?? "");
  const [pets, setPets] = useState(initial?.pets ?? "");
  const [breakfast, setBreakfast] = useState(initial?.breakfast || false);
  const [spa, setSpa] = useState(initial?.spa || false);
  const [checkOut, setCheckOut] = useState(initial?.checkOut || "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [netReceived, setNetReceived] = useState(initial?.netReceived ?? "");
  const [bookingCommissionAmount, setBookingCommissionAmount] = useState(
    initial?.bookingCommissionAmount ??
      (initial?.channel === "booking" && initial?.value && initial?.netReceived !== undefined
        ? Math.max(Number(initial.value) - Number(initial.netReceived), 0)
        : "")
  );
  const [commissionRate, setCommissionRate] = useState(
    initial?.commissionRate !== undefined ? initial.commissionRate * 100 : 13
  );
  const [discountRate, setDiscountRate] = useState(
    initial?.discountRate ? initial.discountRate * 100 : ""
  );
  const [hostPayout, setHostPayout] = useState(
    initial && initial.hostPayout !== "" && initial.hostPayout !== undefined && initial.hostPayout !== null
      ? initial.hostPayout
      : ""
  );
  const [hostPayoutTouched, setHostPayoutTouched] = useState(
    Boolean(initial && initial.hostPayout !== "" && initial.hostPayout !== undefined && initial.hostPayout !== null)
  );
  const [channel, setChannel] = useState(initial?.channel || "");
  const [showChannelInline, setShowChannelInline] = useState(!initial?.channel);
  const [paymentStatus, setPaymentStatus] = useState(initial?.paymentStatus || "pendente");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [error, setError] = useState("");

  function handleChannelChange(nextChannel) {
    setChannel(nextChannel);
    setShowChannelInline(false);
  }

  const isAirbnb = channel === "airbnb";
  const isBooking = channel === "booking";
  // Para Booking, você digita o valor total e o valor da comissão que ela
  // cobrou (ambos aparecem no detalhamento de preço dela); o app calcula o
  // valor líquido automaticamente (total − comissão da Booking), e é sobre
  // esse líquido que sua comissão (%) é aplicada.
  // Airbnb não tem cálculo nenhum: o valor líquido já é o final.
  // Reserva direta calcula a comissão sobre o valor total normalmente.
  const bookingNetReceived = Math.max(
    (Number(value) || 0) - (Number(bookingCommissionAmount) || 0),
    0
  );
  // O valor digitado já é o final (com desconto embutido, se houver).
  // O % de desconto só reduz o repasse sugerido ao anfitrião.
  const baseForCommission = isBooking ? bookingNetReceived : Number(value) || 0;
  const hostPayoutDefined = !isAirbnb && hostPayout !== "";
  const commissionPreview = hostPayoutDefined
    ? baseForCommission - (Number(hostPayout) || 0)
    : baseForCommission * (Number(commissionRate) / 100 || 0);
  const hostAmountPreview = hostPayoutDefined
    ? Number(hostPayout) || 0
    : baseForCommission - commissionPreview;

  const selectedPropObj = newPropertyMode
    ? null
    : properties.find((p) => p.name === propertyName) || null;
  const suggestedPayout = suggestedHostPayout(
    selectedPropObj,
    checkIn,
    checkOut,
    guests,
    breakfast,
    isAirbnb || isBooking ? 0 : (Number(discountRate) || 0) / 100,
    pets,
    spa
  );
  useEffect(() => {
    if (!hostPayoutTouched && !isAirbnb) {
      setHostPayout(suggestedPayout === null ? "" : suggestedPayout);
    }
  }, [suggestedPayout, hostPayoutTouched, isAirbnb]);

  function handleSubmit() {
    const finalProperty = newPropertyMode ? newPropertyName.trim() : propertyName;
    if (!finalProperty || !guestName.trim() || !checkIn || !checkOut) {
      setError("Preencha imóvel, hóspede e as datas de check-in e check-out.");
      return;
    }
    if (checkOut <= checkIn) {
      setError("O check-out precisa ser depois do check-in.");
      return;
    }
    if (newPropertyMode && finalProperty) {
      onAddProperty(finalProperty);
    }
    onSave({
      id: initial?.id,
      propertyName: finalProperty,
      guestName: guestName.trim(),
      guestContact: guestContact.trim(),
      checkIn,
      checkOut,
      guests: guests === "" ? "" : Math.max(Math.round(Number(guests)) || 0, 1),
      pets: pets === "" ? "" : Math.max(Math.round(Number(pets)) || 0, 0),
      breakfast,
      spa,
      value: Number(value) || 0,
      netReceived: isAirbnb ? Number(netReceived) || 0 : isBooking ? bookingNetReceived : 0,
      bookingCommissionAmount: isBooking ? Number(bookingCommissionAmount) || 0 : 0,
      commissionRate: (Number(commissionRate) || 0) / 100,
      discountRate: isAirbnb || isBooking ? 0 : (Number(discountRate) || 0) / 100,
      hostPayout: isAirbnb || hostPayout === "" ? "" : Number(hostPayout) || 0,
      channel,
      paymentStatus,
      notes: notes.trim(),
    });
  }

  return (
    <Sheet title={initial ? "Editar reserva" : "Nova reserva"} onClose={onCancel}>
      <Field label="Nome do hóspede">
        <input style={inputStyle} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
      </Field>

      <div className="mb-5">
        <Field label="Imóvel">
          {!newPropertyMode ? (
            <div className="flex gap-2">
              <select
                style={inputStyle}
                value={propertyName}
                onChange={(e) => setPropertyName(e.target.value)}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <input
              style={inputStyle}
              placeholder="Nome do novo imóvel"
              value={newPropertyName}
              onChange={(e) => setNewPropertyName(e.target.value)}
            />
          )}
          <button
            onClick={() => setNewPropertyMode((v) => !v)}
            className="font-body text-xs mt-1"
            style={{ color: TOKENS.river }}
          >
            {newPropertyMode ? "Escolher imóvel existente" : "+ Adicionar novo imóvel"}
          </button>
        </Field>
      </div>

      <div className="flex gap-3">
        <Field label="Check-in">
          <input
            type="date"
            style={inputStyle}
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </Field>
        <Field label="Check-out">
          <input
            type="date"
            style={inputStyle}
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <Field label="Nº de hóspedes">
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              style={inputStyle}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </Field>
        </div>
        {selectedPropObj &&
          selectedPropObj.petFeePerDay !== "" &&
          selectedPropObj.petFeePerDay !== undefined &&
          selectedPropObj.petFeePerDay !== null && (
            <div className="flex-1">
              <Field label={`Nº de pets (${fmtMoney(selectedPropObj.petFeePerDay)}/diária)`}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  style={inputStyle}
                  value={pets}
                  onChange={(e) => setPets(e.target.value)}
                />
              </Field>
            </div>
          )}
      </div>

      {selectedPropObj &&
        selectedPropObj.breakfastFee !== "" &&
        selectedPropObj.breakfastFee !== undefined &&
        selectedPropObj.breakfastFee !== null && (
          <label
            className="font-body text-sm flex items-center gap-2 mb-3 cursor-pointer"
            style={{ color: TOKENS.ink }}
          >
            <input
              type="checkbox"
              checked={breakfast}
              onChange={(e) => setBreakfast(e.target.checked)}
            />
            Com café da manhã ({fmtMoney(selectedPropObj.breakfastFee)}/
            {selectedPropObj.breakfastUnit === "casal" ? "casal" : "pessoa"} por diária)
          </label>
        )}

      {selectedPropObj &&
        selectedPropObj.spaFeePerDay !== "" &&
        selectedPropObj.spaFeePerDay !== undefined &&
        selectedPropObj.spaFeePerDay !== null && (
          <label
            className="font-body text-sm flex items-center gap-2 mb-3 cursor-pointer"
            style={{ color: TOKENS.ink }}
          >
            <input
              type="checkbox"
              checked={spa}
              onChange={(e) => setSpa(e.target.checked)}
            />
            Com spa ({fmtMoney(selectedPropObj.spaFeePerDay)} por diária)
          </label>
        )}

      <div className="flex items-center justify-between mb-1.5">
        <p className="font-body text-sm" style={{ color: TOKENS.ink }}>
          Canal: <b>{channelLabel(channel)}</b>
        </p>
        <button
          type="button"
          onClick={() => setShowChannelInline((v) => !v)}
          className="font-body text-sm"
          style={{ color: TOKENS.river }}
        >
          Trocar
        </button>
      </div>
      {showChannelInline && (
        <div className="flex gap-2 mb-3">
          {CHANNELS.map((c) => {
            const active = channel === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => handleChannelChange(c.id)}
                className="font-body text-sm flex-1 py-2 rounded-xl"
                style={{
                  background: active ? TOKENS.pine : TOKENS.sand,
                  color: active ? "white" : TOKENS.ink,
                  fontWeight: active ? 600 : 500,
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      {isAirbnb ? (
        <>
          <div className="flex gap-3">
            <Field label="Valor pago pelo hóspede (R$, opcional)">
              <input
                type="number"
                inputMode="decimal"
                style={inputStyle}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Field label="Valor que você recebeu (R$)">
              <input
                type="number"
                inputMode="decimal"
                style={inputStyle}
                value={netReceived}
                onChange={(e) => setNetReceived(e.target.value)}
              />
            </Field>
          </div>
          <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
            Use o valor de "Você recebe" que o Airbnb mostra em Ganhos — já é o
            líquido final, sem mais descontos.
          </p>
        </>
      ) : isBooking ? (
        <>
          <div className="flex gap-3">
            <Field label="Valor total da reserva (R$)">
              <input
                type="number"
                inputMode="decimal"
                style={inputStyle}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Field label="Comissão da Booking (R$)">
              <input
                type="number"
                inputMode="decimal"
                style={inputStyle}
                value={bookingCommissionAmount}
                onChange={(e) => setBookingCommissionAmount(e.target.value)}
              />
            </Field>
          </div>
          <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
            Os dois valores aparecem no "Resumo do preço" da reserva, dentro do
            app da Booking.
          </p>

          <div className="flex items-center justify-between mb-3 px-1">
            <span className="font-body text-sm" style={{ color: TOKENS.ink }}>
              Valor da reserva (líquido)
            </span>
            <span className="font-body text-base font-semibold" style={{ color: TOKENS.ink }}>
              {fmtMoney(bookingNetReceived)}
            </span>
          </div>

          <Field label="Repasse ao anfitrião (R$)">
            <input
              type="number"
              inputMode="decimal"
              style={inputStyle}
              value={hostPayout}
              onChange={(e) => {
                setHostPayout(e.target.value);
                setHostPayoutTouched(true);
              }}
            />
          </Field>
          <p className="font-body text-sm -mt-2 mb-1" style={{ color: TOKENS.moss }}>
            Calculado pelas diárias do imóvel (fim de semana = noites de sexta
            e sábado). Ajuste se preciso; deixe vazio para usar a comissão em %.
          </p>
          {suggestedPayout !== null && Number(hostPayout) !== suggestedPayout && (
            <button
              type="button"
              onClick={() => {
                setHostPayout(suggestedPayout);
                setHostPayoutTouched(true);
              }}
              className="font-body text-xs px-3 py-1.5 rounded-full mb-3"
              style={{ background: TOKENS.sand, color: TOKENS.pine }}
            >
              Sugerido: {fmtMoney(suggestedPayout)} — usar
            </button>
          )}

          {!hostPayoutDefined && (
            <Field label="Sua comissão (%)">
              <input
                type="number"
                inputMode="decimal"
                style={inputStyle}
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
              />
            </Field>
          )}

          <div className="rounded-xl p-3 mb-3" style={{ background: TOKENS.sand }}>
            <div className="flex justify-between font-body text-sm" style={{ color: TOKENS.ink }}>
              <span>Sua comissão</span>
              <b>{fmtMoney(commissionPreview)}</b>
            </div>
            <div
              className="flex justify-between font-body text-sm mt-1 pt-1"
              style={{ color: TOKENS.pine, borderTop: `1px solid ${TOKENS.clayLight}` }}
            >
              <span>Anfitrião recebe</span>
              <b>{fmtMoney(hostAmountPreview)}</b>
            </div>
          </div>
        </>
      ) : (
        <>
          <Field label="Valor total (R$)">
            <input
              type="number"
              inputMode="decimal"
              style={inputStyle}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>

          <Field label="Repasse ao anfitrião (R$)">
            <input
              type="number"
              inputMode="decimal"
              style={inputStyle}
              value={hostPayout}
              onChange={(e) => {
                setHostPayout(e.target.value);
                setHostPayoutTouched(true);
              }}
            />
          </Field>
          <p className="font-body text-sm -mt-2 mb-1" style={{ color: TOKENS.moss }}>
            Calculado pelas diárias do imóvel (fim de semana = noites de sexta
            e sábado). Ajuste se preciso; deixe vazio para usar a comissão em %.
          </p>
          {suggestedPayout !== null && Number(hostPayout) !== suggestedPayout && (
            <button
              type="button"
              onClick={() => {
                setHostPayout(suggestedPayout);
                setHostPayoutTouched(true);
              }}
              className="font-body text-xs px-3 py-1.5 rounded-full mb-3"
              style={{ background: TOKENS.sand, color: TOKENS.pine }}
            >
              Sugerido: {fmtMoney(suggestedPayout)} — usar
            </button>
          )}

          {!hostPayoutDefined && (
            <Field label="Comissão (%)">
              <input
                type="number"
                inputMode="decimal"
                style={inputStyle}
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
              />
            </Field>
          )}

          <Field label="Desconto (%)">
            <div className="flex gap-2 items-center">
              <input
                type="number"
                inputMode="decimal"
                style={{ ...inputStyle, flex: 1 }}
                value={discountRate}
                onChange={(e) => setDiscountRate(e.target.value)}
              />
              {[5, 10].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    setDiscountRate(Number(discountRate) === d ? "" : d)
                  }
                  className="font-body text-sm px-3 py-2 rounded-xl"
                  style={{
                    background:
                      Number(discountRate) === d ? TOKENS.pine : TOKENS.sand,
                    color: Number(discountRate) === d ? "white" : TOKENS.ink,
                  }}
                >
                  {d}%
                </button>
              ))}
            </div>
          </Field>
          <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
            Para estadias longas (7+ dias, costuma ser 10%). O desconto reduz
            apenas o repasse sugerido ao anfitrião — o valor acima já deve ser o
            valor final cobrado do hóspede.
          </p>

          <div className="rounded-xl p-3 mb-3" style={{ background: TOKENS.sand }}>
            <div className="flex justify-between font-body text-sm" style={{ color: TOKENS.ink }}>
              <span>Sua comissão</span>
              <b>{fmtMoney(commissionPreview)}</b>
            </div>
            <div
              className="flex justify-between font-body text-sm mt-1 pt-1"
              style={{ color: TOKENS.pine, borderTop: `1px solid ${TOKENS.clayLight}` }}
            >
              <span>Anfitrião recebe</span>
              <b>{fmtMoney(hostAmountPreview)}</b>
            </div>
          </div>
        </>
      )}

      <Field label="Status de pagamento ao proprietário">
        <select
          style={inputStyle}
          value={paymentStatus}
          onChange={(e) => setPaymentStatus(e.target.value)}
        >
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
        </select>
      </Field>

      <Field label="Observações (opcional)">
        <textarea
          style={{ ...inputStyle, minHeight: 60 }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {error && (
        <p className="font-body text-xs mb-3" style={{ color: TOKENS.danger }}>
          {error}
        </p>
      )}

      <div className="flex gap-3 mt-2">
        <button
          onClick={onCancel}
          className="font-body flex-1 py-2.5 rounded-xl text-sm"
          style={{ background: TOKENS.sand, color: TOKENS.ink }}
        >
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          className="font-body flex-1 py-2.5 rounded-xl text-sm"
          style={{ background: TOKENS.clay, color: "white" }}
        >
          Salvar
        </button>
      </div>
    </Sheet>
  );
}

function PropertiesManager({ properties, deleteError, onEdit, onDeleteRequest }) {
  return (
    <div className="mx-5 mt-2 flex flex-col gap-3">
      {deleteError && (
        <div
          className="rounded-xl p-3 text-sm font-body flex items-start gap-2"
          style={{ background: "#F0E6DB", color: TOKENS.danger }}
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{deleteError}</span>
        </div>
      )}
      {properties.length === 0 && (
        <div className="rounded-2xl p-6 text-center" style={{ background: TOKENS.cream }}>
          <Home size={26} color={TOKENS.moss} className="mx-auto mb-2" />
          <p className="font-body text-sm" style={{ color: TOKENS.ink }}>
            Nenhum imóvel cadastrado ainda. Toque em <b>+</b> para adicionar o
            primeiro.
          </p>
        </div>
      )}
      {properties.length > 0 && (
        <p className="font-body text-sm" style={{ color: TOKENS.moss }}>
          {properties.length} imóve{properties.length === 1 ? "l cadastrado" : "is cadastrados"}
        </p>
      )}
      {properties.map((p) => (
        <div key={p.id} className="rounded-2xl p-4" style={{ background: TOKENS.cream }}>
          <div className="flex items-center gap-3">
            {p.photo && (
              <img
                src={p.photo}
                alt={p.name}
                className="rounded-xl shrink-0"
                style={{ width: 52, height: 52, objectFit: "cover" }}
              />
            )}
            <p className="font-display text-xl" style={{ color: TOKENS.ink, lineHeight: 1.15 }}>
              {p.name}
            </p>
          </div>
          {p.hostName && (
            <p className="font-body text-sm mt-1" style={{ color: TOKENS.moss }}>
              Anfitrião · {p.hostName}
            </p>
          )}
          {p.payoutMode === "faixas" && Array.isArray(p.payoutTiers) && p.payoutTiers.length > 0 ? (
            <div className="mt-2">
              {p.payoutTiers.map((t, i) => (
                <p key={i} className="font-body text-[13.5px] mt-0.5" style={{ color: TOKENS.moss }}>
                  Repasse até {t.maxGuests} hósp.:{" "}
                  <b style={{ color: TOKENS.ink }}>{fmtMoney(t.weekday)}</b> sem. / <b style={{ color: TOKENS.ink }}>{fmtMoney(t.weekend)}</b> fds
                </p>
              ))}
            </div>
          ) : (
            <div className="mt-2">
              {p.hostPayoutWeekday !== "" && p.hostPayoutWeekday !== undefined && p.hostPayoutWeekday !== null && (
                <p className="font-body text-[13.5px] mt-0.5" style={{ color: TOKENS.moss }}>
                  Repasse (dias de semana): <b style={{ color: TOKENS.ink }}>{fmtMoney(p.hostPayoutWeekday)}</b>
                </p>
              )}
              {p.hostPayoutWeekend !== "" && p.hostPayoutWeekend !== undefined && p.hostPayoutWeekend !== null && (
                <p className="font-body text-[13.5px] mt-0.5" style={{ color: TOKENS.moss }}>
                  Repasse (fim de semana): <b style={{ color: TOKENS.ink }}>{fmtMoney(p.hostPayoutWeekend)}</b>
                </p>
              )}
              {p.payoutMode === "adicional" &&
                p.payoutExtraPerGuest !== "" &&
                p.payoutExtraPerGuest !== undefined && (
                  <p className="font-body text-[13.5px] mt-0.5" style={{ color: TOKENS.moss }}>
                    + <b style={{ color: TOKENS.ink }}>{fmtMoney(p.payoutExtraPerGuest)}</b>/diária por pessoa acima de{" "}
                    {p.payoutIncludedGuests || "?"} hósp.
                  </p>
                )}
            </div>
          )}
          {p.breakfastFee !== "" && p.breakfastFee !== undefined && p.breakfastFee !== null && (
            <p className="font-body text-[13.5px] mt-0.5" style={{ color: TOKENS.moss }}>
              Café da manhã: <b style={{ color: TOKENS.ink }}>{fmtMoney(p.breakfastFee)}</b>/
              {p.breakfastUnit === "casal" ? "casal" : "pessoa"} por diária
            </p>
          )}
          {p.cleaningFee !== "" && p.cleaningFee !== undefined && p.cleaningFee !== null && (
            <p className="font-body text-[13.5px] mt-0.5" style={{ color: TOKENS.moss }}>
              Taxa de limpeza: <b style={{ color: TOKENS.ink }}>{fmtMoney(p.cleaningFee)}</b>
            </p>
          )}
          {p.petFeePerDay !== "" && p.petFeePerDay !== undefined && p.petFeePerDay !== null ? (
            <p className="font-body text-[13.5px] mt-0.5" style={{ color: TOKENS.moss }}>
              Taxa de pet: <b style={{ color: TOKENS.ink }}>{fmtMoney(p.petFeePerDay)}</b> / diária
            </p>
          ) : (
            <p className="font-body text-xs mt-0.5" style={{ color: TOKENS.moss, opacity: 0.8 }}>
              Não aceita pets
            </p>
          )}
          {p.spaFeePerDay !== "" && p.spaFeePerDay !== undefined && p.spaFeePerDay !== null && (
            <p className="font-body text-[13.5px] mt-0.5" style={{ color: TOKENS.moss }}>
              Taxa de spa: <b style={{ color: TOKENS.ink }}>{fmtMoney(p.spaFeePerDay)}</b> / diária
            </p>
          )}
          <div
            className="flex flex-wrap gap-4 mt-3 pt-3"
            style={{ borderTop: `1px solid ${TOKENS.sand}` }}
          >
            {p.airbnbLink && (
              <a
                href={normalizeUrl(p.airbnbLink)}
                target="_blank"
                rel="noreferrer"
                className="font-body text-sm flex items-center gap-1"
                style={{ color: "#E0565B" }}
              >
                <ExternalLink size={14} /> Airbnb
              </a>
            )}
            {p.bookingLink && (
              <a
                href={normalizeUrl(p.bookingLink)}
                target="_blank"
                rel="noreferrer"
                className="font-body text-sm flex items-center gap-1"
                style={{ color: "#1A4FA0" }}
              >
                <ExternalLink size={14} /> Booking
              </a>
            )}
            {p.mapsLink && (
              <a
                href={normalizeUrl(p.mapsLink)}
                target="_blank"
                rel="noreferrer"
                className="font-body text-sm flex items-center gap-1"
                style={{ color: TOKENS.river }}
              >
                <MapPin size={14} /> Maps
              </a>
            )}
          </div>
          <div className="flex gap-4 mt-3 pt-3" style={{ borderTop: `1px solid ${TOKENS.sand}` }}>
            <button
              onClick={() => onEdit(p)}
              className="font-body text-sm flex items-center gap-1"
              style={{ color: TOKENS.pine }}
            >
              <Pencil size={15} /> Editar
            </button>
            <button
              onClick={() => onDeleteRequest(p)}
              className="font-body text-sm flex items-center gap-1"
              style={{ color: TOKENS.danger }}
            >
              <Trash2 size={15} /> Excluir
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PropertyForm({ initial, properties, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [hostName, setHostName] = useState(initial?.hostName || "");
  const [hostPayoutWeekday, setHostPayoutWeekday] = useState(initial?.hostPayoutWeekday ?? "");
  const [hostPayoutWeekend, setHostPayoutWeekend] = useState(initial?.hostPayoutWeekend ?? "");
  const [payoutMode, setPayoutMode] = useState(initial?.payoutMode || "simples");
  const [payoutTiers, setPayoutTiers] = useState(
    Array.isArray(initial?.payoutTiers) && initial.payoutTiers.length > 0
      ? initial.payoutTiers
      : [{ maxGuests: "", weekday: "", weekend: "" }]
  );
  const [payoutIncludedGuests, setPayoutIncludedGuests] = useState(initial?.payoutIncludedGuests ?? "");
  const [payoutExtraPerGuest, setPayoutExtraPerGuest] = useState(initial?.payoutExtraPerGuest ?? "");
  const [breakfastFee, setBreakfastFee] = useState(initial?.breakfastFee ?? "");
  const [breakfastUnit, setBreakfastUnit] = useState(initial?.breakfastUnit || "pessoa");
  const [cleaningFee, setCleaningFee] = useState(initial?.cleaningFee ?? "");
  const [petFeePerDay, setPetFeePerDay] = useState(initial?.petFeePerDay ?? "");
  const [spaFeePerDay, setSpaFeePerDay] = useState(initial?.spaFeePerDay ?? "");
  const [mapsLink, setMapsLink] = useState(initial?.mapsLink || "");
  const [airbnbLink, setAirbnbLink] = useState(initial?.airbnbLink || "");
  const [bookingLink, setBookingLink] = useState(initial?.bookingLink || "");
  const [photo, setPhoto] = useState(initial?.photo || "");
  const photoInputRef = useRef(null);

  async function handlePhotoFile(file) {
    if (!file) return;
    try {
      const thumb = await fileToThumb(file);
      setPhoto(thumb);
    } catch (e) {
      setError("Não consegui processar essa imagem. Tente outra foto.");
    }
  }
  const [error, setError] = useState("");

  function updateTier(idx, field, value) {
    setPayoutTiers((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  }

  function handleSubmit() {
    const clean = name.trim();
    if (!clean) {
      setError("Dê um nome para a acomodação.");
      return;
    }
    const duplicate = properties.some(
      (p) => p.name.toLowerCase() === clean.toLowerCase() && p.id !== initial?.id
    );
    if (duplicate) {
      setError("Já existe um imóvel com esse nome.");
      return;
    }
    if (payoutMode === "faixas") {
      const filled = payoutTiers.filter(
        (t) => t.maxGuests !== "" || t.weekday !== "" || t.weekend !== ""
      );
      const invalid = filled.some((t) => t.maxGuests === "" || Number(t.maxGuests) < 1);
      if (invalid) {
        setError("Cada faixa precisa do nº máximo de hóspedes (mínimo 1).");
        return;
      }
    }
    const cleanTiers =
      payoutMode === "faixas"
        ? payoutTiers
            .filter((t) => t.maxGuests !== "" && (t.weekday !== "" || t.weekend !== ""))
            .map((t) => ({
              maxGuests: Math.max(Math.round(Number(t.maxGuests)) || 1, 1),
              weekday: t.weekday === "" ? "" : Number(t.weekday) || 0,
              weekend: t.weekend === "" ? "" : Number(t.weekend) || 0,
            }))
            .sort((a, b) => a.maxGuests - b.maxGuests)
        : [];
    onSave(
      {
        id: initial?.id,
        name: clean,
        hostName: hostName.trim(),
        hostPayoutWeekday: hostPayoutWeekday === "" ? "" : Number(hostPayoutWeekday) || 0,
        hostPayoutWeekend: hostPayoutWeekend === "" ? "" : Number(hostPayoutWeekend) || 0,
        payoutMode,
        payoutTiers: cleanTiers,
        payoutIncludedGuests:
          payoutIncludedGuests === "" ? "" : Math.max(Math.round(Number(payoutIncludedGuests)) || 0, 1),
        payoutExtraPerGuest: payoutExtraPerGuest === "" ? "" : Number(payoutExtraPerGuest) || 0,
        breakfastFee: breakfastFee === "" ? "" : Number(breakfastFee) || 0,
        breakfastUnit,
        cleaningFee: cleaningFee === "" ? "" : Number(cleaningFee) || 0,
        petFeePerDay: petFeePerDay === "" ? "" : Number(petFeePerDay) || 0,
        spaFeePerDay: spaFeePerDay === "" ? "" : Number(spaFeePerDay) || 0,
        mapsLink: normalizeUrl(mapsLink),
        airbnbLink: normalizeUrl(airbnbLink),
        bookingLink: normalizeUrl(bookingLink),
        photo,
      },
      initial?.name
    );
  }

  return (
    <Sheet title={initial ? "Editar imóvel" : "Novo imóvel"} onClose={onCancel}>
      <Field label="Nome da acomodação">
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label="Nome do anfitrião">
        <input style={inputStyle} value={hostName} onChange={(e) => setHostName(e.target.value)} />
      </Field>

      <Field label="Como funciona o repasse ao anfitrião?">
        <div className="flex gap-2 flex-wrap">
          {[
            ["simples", "Valor único"],
            ["faixas", "Por nº de hóspedes"],
            ["adicional", "Base + por pessoa extra"],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPayoutMode(mode)}
              className="font-body text-xs px-3 py-1.5 rounded-full"
              style={{
                background: payoutMode === mode ? TOKENS.pine : TOKENS.sand,
                color: payoutMode === mode ? TOKENS.cream : TOKENS.ink,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      {payoutMode === "faixas" ? (
        <>
          <p className="font-body text-sm mb-2" style={{ color: TOKENS.moss }}>
            Defina o valor da diária conforme o número de hóspedes. Ex: até 2
            pessoas um valor, até 4 outro. A reserva usa a faixa do nº de
            hóspedes informado.
          </p>
          {payoutTiers.map((tier, idx) => (
            <div key={idx} className="flex gap-2 mb-2 items-end">
              <div className="w-20">
                <label className="font-body text-[10px] block mb-1" style={{ color: TOKENS.moss }}>
                  Até (hósp.)
                </label>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  style={inputStyle}
                  value={tier.maxGuests}
                  onChange={(e) => updateTier(idx, "maxGuests", e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="font-body text-[10px] block mb-1" style={{ color: TOKENS.moss }}>
                  Semana (R$)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  style={inputStyle}
                  value={tier.weekday}
                  onChange={(e) => updateTier(idx, "weekday", e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="font-body text-[10px] block mb-1" style={{ color: TOKENS.moss }}>
                  Fim de sem. (R$)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  style={inputStyle}
                  value={tier.weekend}
                  onChange={(e) => updateTier(idx, "weekend", e.target.value)}
                />
              </div>
              {payoutTiers.length > 1 && (
                <button
                  type="button"
                  aria-label="Remover faixa"
                  onClick={() => setPayoutTiers((prev) => prev.filter((_, i) => i !== idx))}
                  className="font-body text-xs px-2 py-2 rounded-lg mb-0.5"
                  style={{ background: TOKENS.sand, color: TOKENS.danger }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPayoutTiers((prev) => [...prev, { maxGuests: "", weekday: "", weekend: "" }])}
            className="font-body text-xs px-3 py-1.5 rounded-full mb-3"
            style={{ background: TOKENS.sand, color: TOKENS.ink }}
          >
            + Adicionar faixa
          </button>
        </>
      ) : (
        <>
          <Field label="Repasse ao anfitrião · dias de semana (R$)">
            <input
              type="number"
              inputMode="decimal"
              style={inputStyle}
              value={hostPayoutWeekday}
              onChange={(e) => setHostPayoutWeekday(e.target.value)}
            />
          </Field>
          <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
            Estadias de domingo a sexta.
          </p>

          <Field label="Repasse ao anfitrião · fim de semana (R$)">
            <input
              type="number"
              inputMode="decimal"
              style={inputStyle}
              value={hostPayoutWeekend}
              onChange={(e) => setHostPayoutWeekend(e.target.value)}
            />
          </Field>
          <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
            Estadias de sexta a domingo. Valor que você repassa ao anfitrião, não o
            que você recebe do hóspede.
          </p>

          {payoutMode === "adicional" && (
            <>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Field label="Hóspedes inclusos no valor base">
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      style={inputStyle}
                      value={payoutIncludedGuests}
                      onChange={(e) => setPayoutIncludedGuests(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex-1">
                  <Field label="Adicional por pessoa extra (R$/diária)">
                    <input
                      type="number"
                      inputMode="decimal"
                      style={inputStyle}
                      value={payoutExtraPerGuest}
                      onChange={(e) => setPayoutExtraPerGuest(e.target.value)}
                    />
                  </Field>
                </div>
              </div>
              <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
                Ex: base para até 2 hóspedes + R$ 30 por pessoa acima disso, por
                diária.
              </p>
            </>
          )}
        </>
      )}

      <Field label="Café da manhã (R$ por diária)">
        <div className="flex gap-2 items-center">
          <input
            type="number"
            inputMode="decimal"
            style={{ ...inputStyle, flex: 1 }}
            value={breakfastFee}
            onChange={(e) => setBreakfastFee(e.target.value)}
          />
          <div className="flex gap-1">
            {[
              ["pessoa", "por pessoa"],
              ["casal", "por casal"],
            ].map(([unit, label]) => (
              <button
                key={unit}
                type="button"
                onClick={() => setBreakfastUnit(unit)}
                className="font-body text-xs px-2.5 py-1.5 rounded-full whitespace-nowrap"
                style={{
                  background: breakfastUnit === unit ? TOKENS.pine : TOKENS.sand,
                  color: breakfastUnit === unit ? TOKENS.cream : TOKENS.ink,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Field>
      <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
        Deixe vazio se o imóvel não oferece café. Quando a reserva incluir café,
        o valor soma no repasse ao anfitrião.
      </p>

      <Field label="Taxa de limpeza (R$)">
        <input
          type="number"
          inputMode="decimal"
          style={inputStyle}
          value={cleaningFee}
          onChange={(e) => setCleaningFee(e.target.value)}
        />
      </Field>
      <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
        Cobrada uma vez por estadia. Deixe vazio se não cobra.
      </p>

      <Field label="Taxa de pet · por diária (R$)">
        <input
          type="number"
          inputMode="decimal"
          style={inputStyle}
          value={petFeePerDay}
          onChange={(e) => setPetFeePerDay(e.target.value)}
        />
      </Field>
      <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
        Deixe vazio se o imóvel não aceita pets.
      </p>

      <Field label="Taxa de spa · por diária (R$)">
        <input
          type="number"
          inputMode="decimal"
          style={inputStyle}
          value={spaFeePerDay}
          onChange={(e) => setSpaFeePerDay(e.target.value)}
        />
      </Field>
      <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
        Deixe vazio se o imóvel não oferece spa.
      </p>

      <Field label="Link do Google Maps">
        <input
          type="url"
          placeholder="https://maps.google.com/..."
          style={inputStyle}
          value={mapsLink}
          onChange={(e) => setMapsLink(e.target.value)}
        />
      </Field>

      <Field label="Link do anúncio no Airbnb">
        <input
          type="url"
          placeholder="https://www.airbnb.com.br/rooms/..."
          style={inputStyle}
          value={airbnbLink}
          onChange={(e) => setAirbnbLink(e.target.value)}
        />
      </Field>

      <Field label="Link do anúncio no Booking">
        <input
          type="url"
          placeholder="https://www.booking.com/hotel/..."
          style={inputStyle}
          value={bookingLink}
          onChange={(e) => setBookingLink(e.target.value)}
        />
      </Field>

      <Field label="Foto do imóvel">
        <input
          type="file"
          accept="image/*"
          ref={photoInputRef}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = "";
            handlePhotoFile(f);
          }}
        />
        <div className="flex items-center gap-3">
          {photo ? (
            <img
              src={photo}
              alt="Foto do imóvel"
              className="rounded-xl"
              style={{ width: 56, height: 56, objectFit: "cover" }}
            />
          ) : (
            <div
              className="rounded-xl flex items-center justify-center"
              style={{ width: 56, height: 56, background: TOKENS.sand }}
            >
              <Camera size={20} color={TOKENS.moss} />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => photoInputRef.current && photoInputRef.current.click()}
              className="font-body text-xs px-3 py-1.5 rounded-full"
              style={{ background: TOKENS.sand, color: TOKENS.ink }}
            >
              {photo ? "Trocar foto" : "Carregar foto"}
            </button>
            {photo && (
              <button
                type="button"
                onClick={() => setPhoto("")}
                className="font-body text-xs px-3 py-1.5 rounded-full"
                style={{ background: TOKENS.sand, color: TOKENS.danger }}
              >
                Remover
              </button>
            )}
          </div>
        </div>
      </Field>
      <p className="font-body text-sm -mt-2 mb-3" style={{ color: TOKENS.moss }}>
        Dica: salve a foto de capa do anúncio do Airbnb no aparelho e carregue
        aqui. A imagem é reduzida para uma miniatura leve.
      </p>

      {error && (
        <p className="font-body text-xs mb-3" style={{ color: TOKENS.danger }}>
          {error}
        </p>
      )}

      <div className="flex gap-3 mt-2">
        <button
          onClick={onCancel}
          className="font-body flex-1 py-2.5 rounded-xl text-sm"
          style={{ background: TOKENS.sand, color: TOKENS.ink }}
        >
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          className="font-body flex-1 py-2.5 rounded-xl text-sm"
          style={{ background: TOKENS.clay, color: "white" }}
        >
          Salvar
        </button>
      </div>
    </Sheet>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const isSuccess = toast.type === "success";
  return (
    <div
      className="fixed top-3 inset-x-0 z-[60] flex justify-center px-5 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div
        className="font-body text-sm px-4 py-2.5 rounded-xl shadow-lg max-w-sm text-center"
        style={{
          background: isSuccess ? TOKENS.pine : TOKENS.danger,
          color: "white",
        }}
      >
        {toast.message}
      </div>
    </div>
  );
}

function BackupModal({ modal, onChangeText, onClose, onImport }) {
  const isExport = modal.mode === "export";
  const taRef = useRef(null);
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(modal.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
      throw new Error("sem clipboard");
    } catch (e) {
      // fallback: seleciona o texto para o usuário copiar manualmente
      if (taRef.current) {
        taRef.current.focus();
        taRef.current.select();
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: TOKENS.cream, maxHeight: "85vh" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl" style={{ color: TOKENS.ink, lineHeight: 1.1 }}>
            {isExport ? "Copiar backup" : "Colar backup"}
          </h2>
          <button onClick={onClose} aria-label="Fechar">
            <X size={18} color={TOKENS.ink} />
          </button>
        </div>
        <p className="font-body text-xs" style={{ color: TOKENS.moss }}>
          {isExport
            ? "Copie todo o texto abaixo e guarde em local seguro (bloco de notas, e-mail, WhatsApp). Ele contém todos os imóveis e reservas."
            : "Cole aqui o texto do backup copiado antes. Atenção: importar substitui todos os imóveis e reservas atuais."}
        </p>
        <textarea
          ref={taRef}
          readOnly={isExport}
          value={modal.text}
          onChange={(e) => !isExport && onChangeText(e.target.value)}
          onFocus={(e) => isExport && e.target.select()}
          spellCheck={false}
          className="font-body text-[11px] rounded-xl p-3 w-full resize-none"
          style={{
            background: "white",
            border: `1px solid ${TOKENS.sand}`,
            color: TOKENS.ink,
            minHeight: "200px",
            flex: 1,
          }}
          placeholder={isExport ? "" : 'Cole o backup aqui ({"properties": ..., "reservations": ...})'}
        />
        <div className="flex gap-2">
          {isExport ? (
            <button
              onClick={copyAll}
              className="font-body text-sm font-semibold flex-1 rounded-xl py-2.5"
              style={{ background: TOKENS.pine, color: "white" }}
            >
              {copied ? "Copiado ✓" : "Copiar tudo"}
            </button>
          ) : (
            <button
              onClick={onImport}
              disabled={!modal.text.trim()}
              className="font-body text-sm font-semibold flex-1 rounded-xl py-2.5"
              style={{
                background: modal.text.trim() ? TOKENS.clay : TOKENS.sand,
                color: modal.text.trim() ? "white" : TOKENS.moss,
              }}
            >
              Importar e substituir
            </button>
          )}
          <button
            onClick={onClose}
            className="font-body text-sm flex-1 rounded-xl py-2.5"
            style={{ background: TOKENS.sand, color: TOKENS.ink }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ message, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(34,38,31,0.5)" }}
        onClick={onCancel}
      />
      <div className="relative rounded-2xl p-5 w-full max-w-sm" style={{ background: TOKENS.cream }}>
        <p className="font-body text-sm mb-4" style={{ color: TOKENS.ink }}>
          {message}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="font-body flex-1 py-2 rounded-xl text-sm"
            style={{ background: TOKENS.sand, color: TOKENS.ink }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="font-body flex-1 py-2 rounded-xl text-sm"
            style={{ background: TOKENS.danger, color: "white" }}
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
