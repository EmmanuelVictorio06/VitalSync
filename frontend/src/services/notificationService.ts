/**
 * Notificações (WhatsApp) dos alertas. Hoje os envios são SIMULADOS (não há
 * provedor real — ver 0008_alerts.sql / notify_team_of_alert). Este módulo
 * existe para isolar o frontend do mecanismo de envio: quando entrar a Edge
 * Function + provedor (Twilio/Meta), só ele muda.
 */
import { alertService } from './alertService';
import type { NotificationLog } from './types';

export const notificationService = {
  getNotificationLogsByAlert(alertId: string): Promise<NotificationLog[]> {
    return alertService.getNotificationLogs(alertId);
  },
  resendWhatsappAlert(alertId: string): Promise<void> {
    return alertService.resendNotification(alertId);
  },
};
