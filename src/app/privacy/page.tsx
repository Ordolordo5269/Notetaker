import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/app/logo";

export const metadata: Metadata = { title: "Privacidad" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/" aria-label="Inicio">
        <Logo className="mb-10" />
      </Link>
      <article className="prose-study">
        <h1>Política de privacidad y uso de grabaciones</h1>
        <p>
          StudyFlow AI es una herramienta personal de estudio. Este documento describe qué datos trata, dónde se guardan
          y qué responsabilidades asumes al grabar una clase.
        </p>
        <h2>Qué datos se guardan</h2>
        <ul>
          <li>Tu cuenta: correo electrónico y una contraseña cifrada (PBKDF2). Nunca se guarda en claro.</li>
          <li>Grabaciones de audio, transcripciones, marcadores, documentos adjuntos y apuntes que generes.</li>
          <li>Un registro de consumo estimado de la API de OpenAI por sesión, para que puedas controlar el gasto.</li>
        </ul>
        <h2>Dónde se guardan</h2>
        <p>
          Los datos se almacenan en la cuenta de Cloudflare de quien despliega la aplicación: la base de datos en D1 y
          los archivos (audio, PDF) en un bucket privado de R2. Ningún archivo es accesible públicamente; cada descarga
          pasa por la aplicación, que comprueba que eres el propietario.
        </p>
        <h2>Proveedores de IA</h2>
        <p>
          Para transcribir y generar apuntes, el audio y el texto se envían a la API de OpenAI. StudyFlow no activa el
          almacenamiento de las respuestas (<code>store: false</code>) y envía un identificador anónimo de usuario para
          la supervisión de abusos. Consulta la política de datos de OpenAI para la API.
        </p>
        <h2>Tu responsabilidad al grabar</h2>
        <p>
          Grabar a una persona puede requerir su consentimiento o estar regulado por la normativa de tu universidad y
          por la legislación de protección de datos y propiedad intelectual de tu país. StudyFlow no puede verificar ni
          garantizar que una grabación sea lícita. Antes de grabar, infórmate y obtén las autorizaciones necesarias.
        </p>
        <h2>Eliminación y retención</h2>
        <p>
          Puedes eliminar cualquier clase en cualquier momento; se borran el audio, la transcripción y los apuntes
          asociados. En Ajustes puedes definir un plazo de retención automática del audio. Al eliminar una clase, los
          archivos se borran del bucket antes que la ficha, de modo que una eliminación a medias siempre se puede
          repetir.
        </p>
      </article>
    </div>
  );
}
