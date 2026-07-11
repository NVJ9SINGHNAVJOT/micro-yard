package models

import "time"

type Media struct {
	ID               string    `json:"id"`
	Filename         string    `json:"filename"`
	OriginalFilename string    `json:"originalFilename"`
	MimeType         string    `json:"mimeType"`
	Size             int64     `json:"size"`
	Category         string    `json:"category"`
	CreatedAt        time.Time `json:"createdAt"`
}
