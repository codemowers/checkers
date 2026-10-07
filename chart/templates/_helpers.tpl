{{/* Prefix short image names; allow fully qualified image overrides. */}}
{{- define "checkers.image" -}}
{{- if and .registry (not (contains "/" .image)) -}}
{{- printf "%s/%s" (trimSuffix "/" .registry) .image -}}
{{- else -}}
{{- .image -}}
{{- end -}}
{{- end -}}
