# The Health Manager can invoke this document on the selected EC2 instance,
# but it cannot supply or alter shell commands through SendCommand.
resource "aws_ssm_document" "store_api_recovery" {
  name            = "${var.project_name}-start-store-api"
  document_type   = "Command"
  document_format = "JSON"
  content         = file("${path.module}/../lambda/store_api_recovery_document.json")

  tags = { Project = var.project_name }
}
