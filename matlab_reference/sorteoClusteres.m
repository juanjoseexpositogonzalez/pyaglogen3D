function [ impactado, impactante ] = sorteoClusteres( clusters, metodo )
%-----------------------------------------------------------------------------------------------------------------------
%
% [ impactado, impactante ] = sorteoClusteres( clusters, metodo )
% Realiza el sorteo entre los elementos dados en el vector de celdas clusters para determinar cuál es el
% clúster impactante y cuál es el impactado. Se tiene en cuenta el método de generación de clústeres ya que
% para el método partícula-clúster (PC) el impactado es siempre el elemento número 1
%
% Argumentos de entrada:
% clusters:     Vector de celdas que contiene la información de los clústers
% metodo:       Método de creación de aglomerados (PC o CC)
%
% Argumentos de salida:
% impactado:    Número del clúster impactado.
% impactante:   Número del clúster impactante.
%
%-----------------------------------------------------------------------------------------------------------------------

    switch metodo
        case 'PC'
            % Realizamos el sorteo entre los clusters
            [ ~, segundo ] = sortear( clusters );
            primero = 1;
            % Puede que el segundo sea el clúster uno por lo que hay que volver a sortear
            while ( segundo == 1 )
                [ ~, segundo ] = sortear( clusters );
            end
            % El impactado es el primero y el impactante el segundo
            impactado = primero;
            impactante = segundo;
        case 'CC'
            % Realizamos el sorteo entre los clusters
            [ primero, segundo ] = sortear( clusters );
            % Sorteamos quién es el impactante y quien el impactado
            orden = [ primero segundo ];
            % Sorteo para ver quien es impactante y quien impactado
            [ impactante, impactado ] = sortear( orden );
            impactado = orden( impactado );
            impactante = orden( impactante );
    end

end

function [ primero, segundo ] = sortear( clusters )

    % Generamos un vector de candidatos
    candidatos = 1 : numel( clusters );
    primero = randi( [ 1, numel( candidatos ) ] );
    primero = candidatos( primero );

    % Eliminamos el numero de la lista de candidatos
    candidatos( primero ) = [];

    segundo = randi( [ 1, numel( candidatos ) ] );
    segundo = candidatos( segundo );
end