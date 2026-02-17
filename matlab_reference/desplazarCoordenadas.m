function desplazado = desplazarCoordenadas( elemento, offset )

% desplazado = desplazar( elemento, offset )
% Desplaza las coordenadas x, y, z dadas por elemento una cantidad dada por offset
%
% Argumentos de entrada:
% elemento:     % matriz con las coordenadas x, y, z a desplazar
% offset:       % vector de desplazamiento
%
% Argumentos de salida:
% desplazado:   % matriz con las coordenadas x, y, z desplazadas
%
desplazado = elemento;

offset = reshape( offset, 1, numel( offset ) );

offset = repmat( offset, size( elemento, 1 ), 1 );

if size( elemento, 2 ) == 3
    desplazado( :, 1 : 3 ) = elemento( :, 1 : 3 ) + offset;
else
    desplazado( :, 3 : 5 ) = elemento( :, 3 : 5 ) + offset;
end


