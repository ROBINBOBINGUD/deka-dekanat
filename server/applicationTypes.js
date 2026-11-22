// Каталог заявок: какие бывают, какие поля спрашиваем, как проверяем.
// Форма в браузере строится из этого же описания — добавить новый вид заявки
// значит добавить один объект сюда.

import { HttpError } from './auth.js';
import { isDate } from './time.js';

const DELIVERY = {
  name: 'delivery', label: 'Как получить', type: 'choice', default: 'electronic',
  options: [
    { value: 'electronic', label: 'Электронная', hint: 'С кодом проверки — придёт сюда, в кабинет' },
    { value: 'paper', label: 'Бумажная', hint: 'С печатью — заберёте в деканате' },
  ],
};

export const TYPES = {
  cert_study: {
    title: 'Справка об обучении', icon: 'file-check', eta: '1 рабочий день',
    about: 'Подтверждает, что вы учитесь в институте. Для банка, работодателя, соцзащиты, военкомата.',
    fields: [
      { name: 'purpose', label: 'Куда нужна справка', type: 'text', max: 120, required: true,
        suggestions: ['По месту требования', 'В Социальный фонд', 'Работодателю', 'В банк', 'В военкомат'] },
      { name: 'copies', label: 'Сколько экземпляров', type: 'number', min: 1, max: 3, default: 1 },
      DELIVERY,
    ],
  },
  cert_income: {
    title: 'Справка о стипендии', icon: 'wallet', eta: '2 рабочих дня',
    about: 'Сумма начислений за выбранный период — для субсидий, пособий и налогового вычета.',
    fields: [
      { name: 'period', label: 'За какой период', type: 'choice', default: 'last6', options: [
        { value: 'last3', label: '3 месяца' }, { value: 'last6', label: '6 месяцев' }, { value: 'last12', label: '12 месяцев' } ] },
      { name: 'purpose', label: 'Для чего', type: 'text', max: 120, required: true,
        suggestions: ['Для оформления субсидии', 'Для соцзащиты', 'Для налогового вычета'] },
      DELIVERY,
    ],
  },
  retake: {
    title: 'Заявление на пересдачу', icon: 'rotate', eta: 'ответ за 2 рабочих дня',
    about: 'Закрыть академический долг: деканат согласует дату с преподавателем и пришлёт её сюда.',
    fields: [
      { name: 'subject', label: 'Дисциплина', type: 'debt', required: true },
      { name: 'wish', label: 'Удобные даты или комментарий', type: 'textarea', max: 400 },
    ],
  },
  session_extend: {
    title: 'Продление сессии', icon: 'calendar-plus', eta: 'ответ за 3 рабочих дня',
    about: 'Если не успеваете сдать сессию по уважительной причине. Подтверждающий документ донесёте в деканат.',
    fields: [
      { name: 'reason', label: 'Причина', type: 'choice', default: 'illness', options: [
        { value: 'illness', label: 'Болезнь' }, { value: 'family', label: 'Семейные обстоятельства' }, { value: 'other', label: 'Другое' } ] },
      { name: 'until', label: 'Продлить до', type: 'date', required: true },
      { name: 'comment', label: 'Комментарий', type: 'textarea', max: 400 },
    ],
  },
  aid: {
    title: 'Материальная помощь', icon: 'heart-hand', eta: 'решение комиссии — до 10 дней',
    about: 'Заявление в стипендиальную комиссию. Основание выбираете сами, документы донесёте после ответа.',
    fields: [
      { name: 'ground', label: 'Основание', type: 'text', max: 160, required: true,
        suggestions: ['Трудная жизненная ситуация', 'Лечение', 'Рождение ребёнка', 'Потеря кормильца', 'Проезд домой'] },
      { name: 'comment', label: 'Что важно знать комиссии', type: 'textarea', max: 600 },
    ],
  },
  duplicate: {
    title: 'Дубликат документа', icon: 'copy', eta: '5 рабочих дней',
    about: 'Потеряли или испортили студенческий, зачётку или пропуск — закажите новый.',
    fields: [
      { name: 'doc', label: 'Какой документ', type: 'choice', default: 'student_card', options: [
        { value: 'student_card', label: 'Студенческий билет' }, { value: 'record_book', label: 'Зачётная книжка' }, { value: 'pass', label: 'Пропуск' } ] },
      { name: 'reason', label: 'Что случилось', type: 'choice', default: 'lost', options: [
        { value: 'lost', label: 'Потерян' }, { value: 'damaged', label: 'Испорчен' }, { value: 'name_change', label: 'Смена фамилии' } ] },
    ],
  },
  free_form: {
    title: 'Вопрос в деканат', icon: 'message', eta: 'ответ в течение дня',
    about: 'Любой вопрос, для которого нет готовой формы. Ответ придёт в переписку внутри заявки.',
    fields: [
      { name: 'topic', label: 'Тема', type: 'text', max: 120, required: true },
      { name: 'text', label: 'Вопрос', type: 'textarea', max: 1500, required: true },
    ],
  },
};

export const STATUS_LABEL = {
  submitted: 'Подана', in_progress: 'В работе', ready: 'Готова', issued: 'Выдана',
  rejected: 'Отказано', cancelled: 'Отменена',
};

// Какие переходы статуса доступны сотруднику.
export const TRANSITIONS = {
  submitted: ['in_progress', 'rejected'],
  in_progress: ['ready', 'rejected'],
  ready: ['issued'],
  issued: [], rejected: [], cancelled: [],
};

export const ACTIVE = ['submitted', 'in_progress', 'ready'];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const cleanMultiline = (v) => String(v ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Проверяет поля заявки и возвращает только известные, приведённые значения.
 * ctx.debts — id дисциплин с долгом у этого студента (для заявления на пересдачу).
 */
export function validatePayload(typeCode, input, ctx) {
  const type = TYPES[typeCode];
  if (!type) throw new HttpError(400, 'Такого вида заявки нет');
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const errors = {};
  for (const f of type.fields) {
    const rawValue = src[f.name];
    if (f.type === 'text' || f.type === 'textarea') {
      const v = f.type === 'text' ? clean(rawValue) : cleanMultiline(rawValue);
      if (f.required && !v) errors[f.name] = 'Заполните это поле';
      else if (v.length > f.max) errors[f.name] = `Не длиннее ${f.max} символов`;
      else out[f.name] = v;
    } else if (f.type === 'number') {
      const n = rawValue === undefined || rawValue === '' ? f.default : Number(rawValue);
      if (!Number.isInteger(n) || n < f.min || n > f.max) errors[f.name] = `От ${f.min} до ${f.max}`;
      else out[f.name] = n;
    } else if (f.type === 'choice') {
      const v = rawValue === undefined || rawValue === '' ? f.default : String(rawValue);
      if (!f.options.some((o) => o.value === v)) errors[f.name] = 'Выберите вариант из списка';
      else out[f.name] = v;
    } else if (f.type === 'date') {
      const v = String(rawValue ?? '');
      if (!isDate(v)) errors[f.name] = 'Укажите дату';
      else if (v < ctx.today) errors[f.name] = 'Дата уже прошла';
      else out[f.name] = v;
    } else if (f.type === 'debt') {
      const v = String(rawValue ?? '');
      if (!ctx.debts.includes(v)) errors[f.name] = 'Выберите дисциплину с задолженностью';
      else out[f.name] = v;
    }
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Проверьте поля формы', { fields: errors });
  return out;
}

/** Человекочитаемые строки «подпись — значение» для карточки заявки. */
export function describePayload(typeCode, payload, subjectName) {
  const type = TYPES[typeCode];
  if (!type) return [];
  const rows = [];
  for (const f of type.fields) {
    const v = payload[f.name];
    if (v === undefined || v === '' || v === null) continue;
    let text = String(v);
    if (f.type === 'choice') text = f.options.find((o) => o.value === v)?.label ?? text;
    if (f.type === 'debt') text = subjectName(v) ?? text;
    if (f.type === 'date') text = v.split('-').reverse().join('.');
    rows.push({ label: f.label, value: text });
  }
  return rows;
}
