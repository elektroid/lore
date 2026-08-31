// Package mail sends outbound email through an authenticated SMTP relay.
//
// There is exactly one use case today (password reset links), so this stays
// a thin wrapper over net/smtp rather than a template engine: one function
// per email, plain text, French copy inline like the rest of the app's
// user-facing strings.
package mail

import (
	"fmt"
	"net/smtp"
	"strings"

	"lore/internal/config"
)

// Mailer sends mail through the configured SMTP relay. A zero-value Mailer
// (empty Host) is valid — Enabled reports false and Send returns an error
// instead of dialing anywhere, so callers on an instance without SMTP
// configured degrade to "no email sent" rather than crashing.
type Mailer struct {
	cfg config.SMTPConfig
}

func New(cfg config.SMTPConfig) *Mailer {
	return &Mailer{cfg: cfg}
}

// Enabled reports whether outbound mail is configured.
func (m *Mailer) Enabled() bool {
	return m.cfg.Enabled()
}

// Send delivers a plain-text message. net/smtp.SendMail negotiates STARTTLS
// itself when the server advertises it (true of every relay this app is
// expected to run against — OVH, Mailgun, SES SMTP, …), so no separate TLS
// dance is needed here.
func (m *Mailer) Send(to, subject, body string) error {
	if !m.Enabled() {
		return fmt.Errorf("smtp not configured")
	}

	addr := fmt.Sprintf("%s:%d", m.cfg.Host, m.cfg.Port)
	auth := smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)

	from := m.cfg.From
	if from == "" {
		from = m.cfg.Username
	}

	var msg strings.Builder
	msg.WriteString("From: " + from + "\r\n")
	msg.WriteString("To: " + to + "\r\n")
	msg.WriteString("Subject: " + subject + "\r\n")
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	msg.WriteString("\r\n")
	msg.WriteString(body)

	return smtp.SendMail(addr, auth, from, []string{to}, []byte(msg.String()))
}

// SendPasswordReset sends the "someone requested a password reset" email.
// resetLink is a complete, absolute URL — the caller builds it from the
// request that triggered the reset, since the backend has no configured
// public base URL to draw on otherwise (see handlers.resetLink).
func (m *Mailer) SendPasswordReset(to, name, resetLink string) error {
	subject := "Réinitialisation de votre mot de passe — Lore Engine"
	body := fmt.Sprintf(
		"Bonjour %s,\n\n"+
			"Une réinitialisation de mot de passe a été demandée pour ce compte.\n\n"+
			"Pour choisir un nouveau mot de passe, suivez ce lien (valable une heure) :\n"+
			"%s\n\n"+
			"Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — "+
			"votre mot de passe actuel reste valide.\n",
		name, resetLink,
	)
	return m.Send(to, subject, body)
}
